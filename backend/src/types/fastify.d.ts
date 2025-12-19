import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    config: {
      accessSecret: string;
      refreshSecret: string;
      accessTtl: number;
      refreshTtl: number;
      cookieOptions: import("@fastify/cookie").CookieSerializeOptions;
      refreshCookieOptions: import("@fastify/cookie").CookieSerializeOptions;
    };
  }
}
