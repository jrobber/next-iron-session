"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.applySession = applySession;
exports.withIronSession = withIronSession;
exports.ironSession = ironSession;

var _ironStore = _interopRequireDefault(require("iron-store"));

var _cookie = _interopRequireDefault(require("cookie"));

var _debug = _interopRequireDefault(require("debug"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const debug = (0, _debug.default)("next-iron-session"); // default time allowed to check for iron seal validity when ttl passed
// see https://hapi.dev/family/iron/api/?v=6.0.0#options

const timestampSkewSec = 60;

function throwOnNoPassword() {
  throw new Error("next-iron-session: Missing parameter `password`");
}

function throwOnNoCookieName() {
  throw new Error("next-iron-session: Missing parameter `cookieName`");
}

function computeCookieMaxAge(ttl) {
  // The next line makes sure browser will expire cookies before seals are considered expired by the server.
  // It also allows for clock difference of 60 seconds maximum between server and clients.
  return (ttl === 0 ? 2147483647 : ttl) - timestampSkewSec;
}

function getCookieOptions({
  userCookieOptions,
  ttl
}) {
  const defaultCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/"
  };
  return { ...defaultCookieOptions,
    ...userCookieOptions,
    maxAge: userCookieOptions.maxAge || computeCookieMaxAge(ttl)
  };
}

async function applySession(req, res, {
  ttl = 15 * 24 * 3600,
  cookieName = throwOnNoCookieName(),
  password = throwOnNoPassword(),
  cookieOptions: userCookieOptions = {}
}) {
  const cookieOptions = getCookieOptions({
    userCookieOptions,
    ttl
  });
  const store = await getOrCreateStore({
    sealed: _cookie.default.parse(req.headers.cookie || "")[cookieName],
    password,
    ttl: ttl * 1000
  });
  const session = {
    set: store.set,
    get: store.get,
    unset: store.unset,

    async save(cookieOptionsOverrides = {}) {
      const seal = await store.seal();

      const cookieValue = _cookie.default.serialize(cookieName, seal, { ...cookieOptions,
        ...cookieOptionsOverrides
      });

      if (cookieValue.length > 4096) {
        throw new Error(`next-iron-session: Cookie length is too big ${cookieValue.length}, browsers will refuse it`);
      }

      const existingSetCookie = [res.getHeader("set-cookie") || []].flat();
      res.setHeader("set-cookie", [...existingSetCookie, cookieValue]);
      return cookieValue;
    },

    destroy() {
      store.clear();

      const cookieValue = _cookie.default.serialize(cookieName, "", { ...cookieOptions,
        maxAge: 0
      });

      const existingSetCookie = [res.getHeader("set-cookie") || []].flat();
      res.setHeader("set-cookie", [...existingSetCookie, cookieValue]);
    }

  };
  req.session = session;
}

function withIronSession(withIronSessionWrapperHandler, {
  ttl = 15 * 24 * 3600,
  cookieName = throwOnNoCookieName(),
  password = throwOnNoPassword(),
  cookieOptions = {}
}) {
  return async function withIronSessionHandler(...args) {
    const handlerType = args[0] && args[1] ? "api" : "ssr";
    const req = handlerType === "api" ? args[0] : args[0].req;
    const res = handlerType === "api" ? args[1] : args[0].res;
    await applySession(req, res, {
      ttl,
      cookieName,
      password,
      cookieOptions
    });
    return withIronSessionWrapperHandler(...args);
  };
}

function ironSession({
  ttl = 15 * 24 * 3600,
  cookieName = throwOnNoCookieName(),
  password = throwOnNoPassword(),
  cookieOptions = {}
}) {
  return function (req, res, next) {
    applySession(req, res, {
      ttl,
      cookieName,
      password,
      cookieOptions
    }).then(() => {
      next();
    }).catch(next);
  };
}

async function getOrCreateStore({
  sealed,
  password,
  ttl
}) {
  try {
    return await (0, _ironStore.default)({
      sealed,
      password,
      ttl
    });
  } catch (err) {
    if (err.message === "Expired seal" || err.message === "Bad hmac value" || err.message === "Cannot find password: ") {
      debug("Received error from Iron: %s, session was automatically restarted", err.message); // if seal expires or
      // if seal is not valid (encrypted using a different password, when passwords are updated) or
      // if we can't find back the password in the seal
      // then we just start a new session over

      return await (0, _ironStore.default)({
        password,
        ttl
      });
    }

    throw err;
  }
}
//# sourceMappingURL=index.js.map