package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/nicholas-fedor/shoutrrr/pkg/router"
	"github.com/nicholas-fedor/shoutrrr/pkg/types"
)

const budget = 12 * time.Second

var blocked = errors.New("target_blocked")
var special = []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001::/23", "2001:db8::/32", "2002::/16"}

func public(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, cidr := range special {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}

type lookup func(context.Context, string) ([]netip.Addr, error)
type connect func(context.Context, string, string) (net.Conn, error)

func pinnedDial(resolve lookup, dial connect) connect {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		ctx, cancel := context.WithTimeout(ctx, budget)
		defer cancel()
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, blocked
		}
		host = strings.TrimSuffix(strings.ToLower(host), ".")
		for _, suffix := range []string{".localhost", ".local", ".internal", ".lan"} {
			if host == strings.TrimPrefix(suffix, ".") || strings.HasSuffix(host, suffix) {
				return nil, blocked
			}
		}
		var ips []netip.Addr
		if ip, err := netip.ParseAddr(host); err == nil {
			ips = []netip.Addr{ip}
		} else {
			ips, err = resolve(ctx, host)
			if err != nil {
				return nil, errors.New("dns_failed")
			}
		}
		if len(ips) == 0 {
			return nil, errors.New("dns_failed")
		}
		for _, ip := range ips {
			if !public(ip) {
				return nil, blocked
			}
		}
		// Validate the complete answer set before attempting any literal address.
		deadline, _ := ctx.Deadline()
		for i, ip := range ips {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			// Reserve an equal share of the remaining budget for each untried address.
			attemptCtx, cancelAttempt := context.WithTimeout(ctx, time.Until(deadline)/time.Duration(len(ips)-i))
			var conn net.Conn
			conn, err = dial(attemptCtx, network, net.JoinHostPort(ip.String(), port))
			cancelAttempt()
			if err == nil {
				return conn, nil
			}
		}
		return nil, err
	}
}

type safeClient struct {
	mu     sync.Mutex
	client *http.Client
	status int
	code   string
}

func (c *safeClient) Do(req *http.Request) (*http.Response, error) {
	return c.do(req, false)
}

func (c *safeClient) do(req *http.Request, inspectStatus bool) (*http.Response, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status, c.code = 0, ""
	if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
		c.code = "target_blocked"
		return nil, blocked
	}
	resp, err := c.client.Do(req)
	if err != nil {
		c.code = "request_failed"
		if errors.Is(err, blocked) {
			c.code = "target_blocked"
		}
		return nil, errors.New(c.code)
	}
	c.status = resp.StatusCode
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.code = "http_failed"
		// Discord and Matrix handle HTTP errors themselves, including their
		// provider-bounded retries. Redirects still fail for both providers.
		if !inspectStatus || resp.StatusCode < 400 {
			resp.Body.Close()
			return nil, errors.New(c.code)
		}
	}
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.LimitReader(resp.Body, 65536), resp.Body}
	return resp, nil
}

type discordClient struct {
	client *safeClient
	wait   string
}

func (c discordClient) Do(req *http.Request) (*http.Response, error) {
	if c.wait != "" {
		req = req.Clone(req.Context())
		query := req.URL.Query()
		query.Set("wait", c.wait)
		req.URL.RawQuery = query.Encode()
	}
	return c.client.do(req, true)
}

type matrixClient struct {
	client *safeClient
}

func (c matrixClient) Do(req *http.Request) (*http.Response, error) {
	return c.client.do(req, true)
}

type request struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Message string `json:"message"`
}
type result struct {
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
	Provider string `json:"provider,omitempty"`
	Status   int    `json:"status,omitempty"`
}

const providers = " discord generic gotify googlechat hangouts homeassistant ifttt join lark matrix mattermost notifiarr opsgenie pagerduty pushbullet pushover rocketchat signal signalgrid slack teams telegram twilio wecom zulip bark "

func deliver(ctx context.Context, input request, client *safeClient, dial connect) result {
	u, err := url.Parse(input.URL)
	if err != nil {
		return result{Error: "invalid_url"}
	}
	provider := strings.Split(u.Scheme, "+")[0]
	if !strings.Contains(providers, " "+provider+" ") {
		return result{Error: "unsupported_provider"}
	}
	r := result{Provider: provider}
	var httpClient types.HTTPClient = client
	if provider == "discord" {
		query, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			r.Error = "invalid_url"
			return r
		}
		wait := query.Get("wait")
		if values, ok := query["wait"]; ok {
			if len(values) != 1 || (wait != "true" && wait != "false") {
				r.Error = "invalid_url"
				return r
			}
			// wait belongs to the Discord API, not the library's config keys.
			query.Del("wait")
			u.RawQuery = query.Encode()
		}
		httpClient = discordClient{client: client, wait: wait}
	} else if provider == "matrix" {
		httpClient = matrixClient{client: client}
	}
	client.mu.Lock()
	client.status, client.code = 0, ""
	client.mu.Unlock()
	sender, err := router.NewWithOptions(log.New(io.Discard, "", 0), types.SenderOptions{HTTPClient: httpClient, DialContext: types.DialContextFunc(dial), Timeout: budget}, u.String())
	if err != nil {
		r.Error = "invalid_url"
		return r
	}
	defer sender.Close()
	params := types.Params{"title": input.Title}
	for key := range u.Query() {
		if strings.EqualFold(key, "title") {
			params["title"] = u.Query().Get(key)
		}
	}
	sendFailed := false
	for _, err := range sender.SendContext(ctx, input.Message, &params) {
		if err != nil {
			sendFailed = true
			break
		}
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	// A provider must not turn a rejected HTTP response into silent success.
	if sendFailed || client.code != "" {
		r.Error = client.code
		if r.Error == "" {
			r.Error = "send_failed"
		}
		r.Status = client.status
		return r
	}
	r.Success = true
	return r
}
func main() {
	log.SetOutput(io.Discard)
	r := result{Error: "invalid_input"}
	defer func() {
		if recover() != nil {
			r = result{Error: "bridge_failed"}
		}
		json.NewEncoder(os.Stdout).Encode(r)
	}()
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 262145))
	var input request
	if err != nil || len(data) > 262144 || json.Unmarshal(data, &input) != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	dial := pinnedDial(func(ctx context.Context, host string) ([]netip.Addr, error) {
		return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	}, (&net.Dialer{Timeout: budget}).DialContext)
	transport := &http.Transport{DialContext: dial, TLSHandshakeTimeout: budget, ResponseHeaderTimeout: budget, MaxResponseHeaderBytes: 16384}
	defer transport.CloseIdleConnections()
	client := &safeClient{client: &http.Client{Transport: transport, Timeout: budget, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	r = deliver(ctx, input, client, dial)
}
