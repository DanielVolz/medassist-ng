package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLibraryEcho(t *testing.T) {
	type echoRequest struct {
		method   string
		path     string
		rawQuery string
		query    url.Values
		header   http.Header
		body     string
	}
	echoes := make(chan echoRequest, 8)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		echoes <- echoRequest{
			method:   r.Method,
			path:     r.URL.Path,
			rawQuery: r.URL.RawQuery,
			query:    r.URL.Query(),
			header:   r.Header.Clone(),
			body:     string(data),
		}
		if r.URL.Query().Get("redirect") != "" {
			w.Header().Set("Location", "/secret")
			w.WriteHeader(302)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"status":1,"ok":true,"result":{"message_id":1},"id":1}`)
	}))
	defer server.Close()
	dial := pinnedDial(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, _, address string) (net.Conn, error) {
		if !strings.HasPrefix(address, "93.184.216.34:") {
			t.Errorf("not pinned: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", strings.TrimPrefix(server.URL, "https://"))
	})
	client := &safeClient{client: &http.Client{Transport: &http.Transport{DialContext: dial, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	pushoverToken := strings.Repeat("a", 30)
	pushoverUser := strings.Repeat("b", 30)
	for _, target := range []struct {
		provider string
		url      string
	}{
		{provider: "generic", url: "generic://public.example/hook?method=POST&template=json&token=fixture&item=one&title=Configured"},
		{provider: "gotify", url: "gotify://public.example/base/A12345678901234?priority=8"},
		{provider: "telegram", url: "telegram://123:abc@telegram?chats=1"},
		{provider: "pushover", url: "pushover://shoutrrr:" + pushoverToken + "@" + pushoverUser + "/?devices=fixture-device&priority=1"},
		{provider: "discord", url: "discord://fixture-token@123456789012345678?thread_id=987654321"},
	} {
		r := deliver(context.Background(), request{URL: target.url, Title: "Title", Message: "Body"}, client, dial)
		if !r.Success {
			t.Fatalf("%s: %+v", target.provider, r)
		}
		observed := <-echoes
		if !strings.Contains(observed.body, "Body") {
			t.Fatalf("%s: missing provider payload", target.provider)
		}
		switch target.provider {
		case "generic":
			if observed.method != "POST" || observed.query.Get("token") != "fixture" || observed.query.Get("item") != "one" {
				t.Fatalf("Generic method/query mapping mismatch: %+v", observed)
			}
			var payload map[string]string
			if err := json.Unmarshal([]byte(observed.body), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["title"] != "Configured" || payload["message"] != "Body" {
				t.Fatalf("Generic title/message mapping mismatch: %v", payload)
			}
		case "gotify":
			if observed.method != http.MethodPost || observed.path != "/base/message" {
				t.Fatalf("Gotify endpoint mismatch: method=%q path=%q", observed.method, observed.path)
			}
			if observed.query.Get("token") != "A12345678901234" || observed.header.Get("X-Gotify-Key") != "" {
				t.Fatal("Gotify token was not sent only in the configured query location")
			}
			if observed.header.Get("Content-Type") != "application/json" {
				t.Fatalf("Gotify content type mismatch: %q", observed.header.Get("Content-Type"))
			}
			var payload struct {
				Message  string `json:"message"`
				Title    string `json:"title"`
				Priority int    `json:"priority"`
			}
			if err := json.Unmarshal([]byte(observed.body), &payload); err != nil {
				t.Fatalf("decode Gotify payload: %v", err)
			}
			if payload.Message != "Body" || payload.Title != "Title" || payload.Priority != 8 {
				t.Fatalf("Gotify payload mismatch: %+v", payload)
			}
		case "telegram":
			if observed.method != http.MethodPost || observed.path != "/bot123:abc/sendMessage" {
				t.Fatalf("Telegram endpoint mismatch: method=%q path=%q", observed.method, observed.path)
			}
			if observed.rawQuery != "" || observed.header.Get("Authorization") != "" {
				t.Fatal("Telegram token was not confined to the Bot API path")
			}
			if observed.header.Get("Content-Type") != "application/json" {
				t.Fatalf("Telegram content type mismatch: %q", observed.header.Get("Content-Type"))
			}
			var payload struct {
				ChatID    string `json:"chat_id"`
				Text      string `json:"text"`
				ParseMode string `json:"parse_mode"`
			}
			if err := json.Unmarshal([]byte(observed.body), &payload); err != nil {
				t.Fatalf("decode Telegram payload: %v", err)
			}
			if payload.ChatID != "1" || payload.Text != "<b>Title</b>\nBody" || payload.ParseMode != "HTML" {
				t.Fatalf("Telegram payload mismatch: %+v", payload)
			}
		case "pushover":
			if observed.method != http.MethodPost || observed.path != "/1/messages.json" {
				t.Fatalf("Pushover endpoint mismatch: method=%q path=%q", observed.method, observed.path)
			}
			if observed.rawQuery != "" || observed.header.Get("Authorization") != "" {
				t.Fatal("Pushover credentials should be sent in the form body, not the URL or Authorization header")
			}
			if observed.header.Get("Content-Type") != "application/x-www-form-urlencoded" {
				t.Fatalf("Pushover content type mismatch: %q", observed.header.Get("Content-Type"))
			}
			form, err := url.ParseQuery(observed.body)
			if err != nil {
				t.Fatalf("decode Pushover form: %v", err)
			}
			if form.Get("token") != pushoverToken || form.Get("user") != pushoverUser ||
				form.Get("message") != "Body" || form.Get("title") != "Title" ||
				form.Get("priority") != "1" || form.Get("device") != "fixture-device" {
				t.Fatal("Pushover form payload or credential placement mismatch")
			}
		case "discord":
			if observed.query.Get("thread_id") != "987654321" {
				t.Fatalf("Discord thread_id was not forwarded: %+v", observed)
			}
		}
	}
	r := deliver(context.Background(), request{URL: "generic://public.example/hook?redirect=1"}, client, dial)
	<-echoes
	if r.Error != "http_failed" || r.Status != 302 {
		t.Fatalf("redirect accepted: %+v", r)
	}
}

func TestRejectEveryAddress(t *testing.T) {
	for _, bad := range []string{"127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "::1", "::ffff:192.168.1.1", "fd00::1", "fe80::1", "2001:db8::1"} {
		dial := pinnedDial(func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr(bad)}, nil
		}, func(context.Context, string, string) (net.Conn, error) {
			t.Fatal("blocked address dialed")
			return nil, nil
		})
		if _, err := dial(context.Background(), "tcp", "public.example:443"); err != blocked {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestDiscordWaitQueryIsAccepted(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	dial := pinnedDial(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, _, address string) (net.Conn, error) {
		if !strings.HasPrefix(address, "93.184.216.34:") {
			t.Errorf("not pinned: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", strings.TrimPrefix(server.URL, "https://"))
	})
	client := &safeClient{client: &http.Client{
		Transport: &http.Transport{DialContext: dial, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}}

	result := deliver(context.Background(), request{
		URL:     "discord://fixture-token@123456789012345678?thread_id=987654321&wait=true",
		Title:   "Title",
		Message: "Body",
	}, client, dial)
	if !result.Success {
		t.Fatalf("valid Discord wait query rejected: %+v", result)
	}
}

func TestPinnedDialFallsBackToNextPublicAddress(t *testing.T) {
	var attempts atomic.Int32
	dial := pinnedDial(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("93.184.216.34"),
			netip.MustParseAddr("1.1.1.1"),
		}, nil
	}, func(context.Context, string, string) (net.Conn, error) {
		if attempts.Add(1) == 1 {
			return nil, errors.New("fixture connection failure")
		}
		client, server := net.Pipe()
		server.Close()
		return client, nil
	})

	conn, err := dial(context.Background(), "tcp", "public.example:443")
	if err != nil {
		t.Fatalf("expected second public address to be attempted, got %v after %d attempt(s)", err, attempts.Load())
	}
	conn.Close()
	if got := attempts.Load(); got != 2 {
		t.Fatalf("expected 2 address attempts, got %d", got)
	}
}

func TestPinnedDialBoundsAttemptsByRemainingDeadline(t *testing.T) {
	var attempts atomic.Int32
	dial := pinnedDial(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("93.184.216.34"),
			netip.MustParseAddr("1.1.1.1"),
		}, nil
	}, func(ctx context.Context, _, _ string) (net.Conn, error) {
		if attempts.Add(1) == 1 {
			<-ctx.Done()
			return nil, ctx.Err()
		}
		client, server := net.Pipe()
		server.Close()
		return client, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()

	conn, err := dial(ctx, "tcp", "public.example:443")
	if err != nil {
		t.Fatalf("expected fallback after the first address budget expired, got %v after %d attempt(s)", err, attempts.Load())
	}
	conn.Close()
	if got := attempts.Load(); got != 2 {
		t.Fatalf("expected 2 address attempts, got %d", got)
	}
}

func TestDiscordRetriesRateLimitedEchoResponse(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if requests.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			io.WriteString(w, `{"message":"fixture rate limit","retry_after":0}`)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	dial := pinnedDial(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, _, address string) (net.Conn, error) {
		if !strings.HasPrefix(address, "93.184.216.34:") {
			t.Errorf("not pinned: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", strings.TrimPrefix(server.URL, "https://"))
	})
	client := &safeClient{client: &http.Client{
		Transport: &http.Transport{DialContext: dial, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}}

	result := deliver(context.Background(), request{
		URL:     "discord://fixture-token@123456789012345678",
		Title:   "Title",
		Message: "Body",
	}, client, dial)
	if !result.Success || requests.Load() != 2 {
		t.Fatalf("expected rate-limit retry followed by success; result=%+v requests=%d", result, requests.Load())
	}
}

func TestMatrixRetriesRateLimitedEchoResponse(t *testing.T) {
	var sends atomic.Int32
	var firstSendPath string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/send/m.room.message/") {
			t.Errorf("unexpected Matrix request path: %q", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPut || r.Header.Get("Authorization") != "Bearer fictional-matrix-token" {
			t.Errorf("unexpected Matrix send request: method=%q authorization=%q", r.Method, r.Header.Get("Authorization"))
		}
		send := sends.Add(1)
		if send == 1 {
			firstSendPath = r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			io.WriteString(w, `{"errcode":"M_LIMIT_EXCEEDED","error":"fixture response","retry_after_ms":1}`)
			return
		}
		if send == 2 && r.URL.Path != firstSendPath {
			t.Errorf("Matrix retry changed transaction path: first=%q retry=%q", firstSendPath, r.URL.Path)
		}
		if send == 3 {
			w.Header().Set("Retry-After", "30")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			io.WriteString(w, `{"errcode":"M_LIMIT_EXCEEDED","error":"fictional-matrix-token must not escape"}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"event_id":"$fixture"}`)
	}))
	defer server.Close()
	dial := pinnedDial(func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, _, address string) (net.Conn, error) {
		if !strings.HasPrefix(address, "93.184.216.34:") {
			t.Errorf("not pinned: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", strings.TrimPrefix(server.URL, "https://"))
	})
	client := &safeClient{client: &http.Client{
		Transport: &http.Transport{DialContext: dial, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}}

	result := deliver(context.Background(), request{
		URL:     "matrix://:fictional-matrix-token@public.example/?rooms=%21room%3Aexample.org",
		Title:   "Title",
		Message: "Body",
	}, client, dial)
	if !result.Success || sends.Load() != 2 {
		t.Fatalf("expected a rate-limit retry followed by success; result=%+v sends=%d", result, sends.Load())
	}

	failed := deliver(context.Background(), request{
		URL:     "matrix://:fictional-matrix-token@public.example/?rooms=%21room%3Aexample.org",
		Title:   "Title",
		Message: "Body",
	}, client, dial)
	if failed.Success || failed.Error != "http_failed" || failed.Status != http.StatusTooManyRequests || sends.Load() != 3 {
		t.Fatalf("expected bounded sanitized rate-limit failure without a retry; result=%+v sends=%d", failed, sends.Load())
	}
	if strings.Contains(failed.Error, "fictional-matrix-token") {
		t.Fatalf("Matrix response leaked into error: %+v", failed)
	}
}
