// AUTO-EXTRACTED from akashdh11/skystream lib/core/extensions/engine/js_engine_worker.dart
// ---- _kPolyfillJs (verbatim from SkyStream app js_engine_worker.dart)

  var global = globalThis;
  var console = {
    log:  function(msg) { sendMessage('console_log',   JSON.stringify(msg)); },
    error:function(msg) { sendMessage('console_error', JSON.stringify(msg)); },
    warn: function(msg) { sendMessage('console_log', "WARN: " + JSON.stringify(msg)); }
  };
  function log(msg) { console.log(msg); }

  globalThis.executeCallback = function(id, result, error) {
    sendMessage('js_dispatch_callback', JSON.stringify({
      callbackId: id, result: result, error: error
    }));
  };

  const _dartAsyncRegistry = {};
  globalThis._resolveDartAsync = function(id, result, isError) {
    const cb = _dartAsyncRegistry[id];
    if (cb) {
      delete _dartAsyncRegistry[id];
      if (isError) cb.reject(result);
      else cb.resolve(result);
    }
  };

  function _dartAsyncCall(messageId, params) {
    return new Promise((resolve, reject) => {
      const id = "async_" + Math.random().toString(36).substr(2, 9);
      _dartAsyncRegistry[id] = { resolve, reject };
      sendMessage(messageId, JSON.stringify({ id: id, ...params }));
    });
  }

  function _dartHttp(method, url, headers, body) {
    if (method === 'POST' && typeof headers === 'object' && headers !== null && !body && (headers.body || headers.headers)) {
      body = headers.body; headers = headers.headers;
    }
    return _dartAsyncCall('http_request', { method, url, headers: headers || {}, body });
  }

  function _createHybridResponse(res) {
    if (typeof res !== 'object' || res === null) return res;
    var hybrid = new String(res.body || "");
    Object.defineProperty(hybrid, 'status',     { value: res.status,    enumerable: false });
    Object.defineProperty(hybrid, 'statusCode', { value: res.status,    enumerable: false });
    Object.defineProperty(hybrid, 'body',       { value: res.body,      enumerable: false });
    Object.defineProperty(hybrid, 'headers',    { value: res.headers,   enumerable: false });
    return hybrid;
  }

  globalThis.http_get = function(url, headers, cb) {
    return _dartHttp('GET', url, headers, null).then(function(res) {
      if (cb && typeof cb === 'function') cb(res);
      return res;
    });
  };
  globalThis.http_post = function(url, headers, body, cb) {
    return _dartHttp('POST', url, headers, body).then(function(res) {
      if (cb && typeof cb === 'function') cb(res);
      return res;
    });
  };
  globalThis.http_parallel = function(requests) {
    return _dartAsyncCall('http_parallel', { requests: requests });
  };
  globalThis.getAndUnpack = function(js) {
    return sendMessage('js_unpack', js);
  };
  globalThis.parse_html = function(html, selector, attr) {
    return _dartAsyncCall('parse_html', { html: html, selector: selector, attr: attr });
  };
  async function _fetch(url) { return await http_get(url, {}); }

// ---- _kTimerJs (verbatim from SkyStream app js_engine_worker.dart)

  globalThis.timeout_registry = {};

  function setTimeout(callback, delay) {
    var id = "t_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    globalThis.timeout_registry[id] = function() {
      if (!globalThis.timeout_registry[id]) return;
      delete globalThis.timeout_registry[id];
      try { callback(); } catch (e) { console.error('Timeout error:', e); }
    };
    sendMessage('js_set_timeout', JSON.stringify({ id: id, delay: delay || 0 }));
    return id;
  }
  function clearTimeout(id) { if (id) delete globalThis.timeout_registry[id]; }
  function setInterval(cb, d) {
    var id = "i_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    var wrapper = function() {
      if (!globalThis.timeout_registry[id]) return;
      try { cb(); } catch (e) { console.error('Interval error:', e); }
      if (globalThis.timeout_registry[id]) {
        sendMessage('js_set_timeout', JSON.stringify({ id: id, delay: d || 0 }));
      }
    };
    globalThis.timeout_registry[id] = wrapper;
    sendMessage('js_set_timeout', JSON.stringify({ id: id, delay: d || 0 }));
    return id;
  }
  function clearInterval(id) { clearTimeout(id); }

  function setPreference(key, value) {
    sendMessage('set_storage', JSON.stringify({ key: key, value: value }));
  }
  function getPreference(key) {
    return _dartAsyncCall('get_storage', { key: key });
  }

// ---- _kEntitiesJs (verbatim from SkyStream app js_engine_worker.dart)

  class Actor    { constructor(p) { Object.assign(this, p); } }
  class Trailer  { constructor(p) { Object.assign(this, p); } }
  class NextAiring { constructor(p) { Object.assign(this, p); } }

  class MultimediaItem {
    constructor(params) {
      Object.assign(this, {
        type: 'movie', status: 'ongoing', playbackPolicy: 'none',
        isAdult: false, streams: [], syncData: {}, ...params
      });
    }
  }
  class Episode {
    constructor(params) {
      Object.assign(this, {
        season: 0, episode: 0, dubStatus: 'none', playbackPolicy: 'none',
        streams: [], ...params
      });
    }
  }
  class StreamResult {
    constructor({ url, source, headers, subtitles, drmKid, drmKey, licenseUrl }) {
      this.url = url; this.source = source || 'Auto'; this.headers = headers;
      this.subtitles = subtitles; this.drmKid = drmKid;
      this.drmKey = drmKey; this.licenseUrl = licenseUrl;
    }
  }
  globalThis.MultimediaItem = MultimediaItem;
  globalThis.Episode = Episode;
  globalThis.StreamResult = StreamResult;
  globalThis.Actor = Actor;
  globalThis.Trailer = Trailer;
  globalThis.NextAiring = NextAiring;

  var CloudStream = {
    getLanguage: function() { return "en"; },
    getRegion:   function() { return "US"; }
  };

  globalThis.solveCaptcha = function(siteKey, url) {
    return _dartAsyncCall('solve_captcha', { siteKey, url: url || "" });
  };

  globalThis.crypto = {
    decryptAES: function(data, key, iv, options) {
      return _dartAsyncCall('crypto_decrypt_aes', {
        data, key, iv, mode: (options && options.mode) || 'cbc'
      });
    },
    pbkdf2: function(password, salt, iterations, keyLength) {
      return _dartAsyncCall('crypto_pbkdf2', {
        password, salt, iterations: iterations || 10000, keyLength: keyLength || 32
      });
    }
  };

  globalThis.JSDOM = class JSDOM {
    constructor(html) {
      this._initPromise = _dartAsyncCall('dom_parse', { html }).then((id) => {
        this.window = { document: new JSDocument(id) };
        return this;
      });
    }
    async waitForInit() { return await this._initPromise; }
  };

  globalThis.parseHtml = async function(html) {
    const dom = new JSDOM(html);
    await dom.waitForInit();
    return dom.window.document;
  };

  class JSNode {
    constructor(nodeId, data) {
      this.nodeId = nodeId; this.data = data || {};
      this.textContent = this.data.textContent || "";
      this.innerHTML   = this.data.innerHTML   || "";
      this.outerHTML   = this.data.outerHTML   || "";
      this.tagName     = this.data.tagName     || "";
    }
    get className() { return this.getAttribute('class') || ""; }
    getAttribute(name) { return this.data.attributes ? this.data.attributes[name] : null; }
    querySelector(query) {
      var res = sendMessage('dom_query', JSON.stringify({ nodeId: this.nodeId, query, multi: false }));
      if (typeof res === 'string') res = JSON.parse(res);
      return res ? new JSNode(res.nodeId, res) : null;
    }
    querySelectorAll(query) {
      var res = sendMessage('dom_query', JSON.stringify({ nodeId: this.nodeId, query, multi: true }));
      if (typeof res === 'string') res = JSON.parse(res);
      return (res || []).map(d => new JSNode(d.nodeId, d));
    }
  }
  class JSDocument extends JSNode {
    constructor(id) { super(id, { nodeId: id }); }
    get body() { return this.querySelector('body'); }
  }

  globalThis.atob = function(str) {
    if (!str) return "";
    try {
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      var output = ''; str = String(str).replace(/=+$/, '');
      for (var bc=0,bs,buffer,idx=0; buffer=str.charAt(idx++); ~buffer&&(bs=bc%4?bs*64+buffer:buffer, bc++%4)?output+=String.fromCharCode(255&bs>>(-2*bc&6)):0) {
        buffer=chars.indexOf(buffer);
      }
      return output;
    } catch(e) { return ""; }
  };
  globalThis.btoa = function(str) {
    if (!str) return "";
    try {
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      var output = '';
      for (var block,charCode,bc=0,idx=0,map=chars; str.charAt(idx|0)||(map='=',idx%1); output+=map.charAt(63&block>>8-idx%1*8)) {
        charCode=str.charCodeAt(idx+=3/4);
        if (charCode>0xFF) throw new Error("'btoa' failed");
        block=block<<8|charCode;
      }
      return output;
    } catch(e) { return ""; }
  };

  globalThis.URL = class URL {
    constructor(url, base) {
      this.href = url;
      if (base) {
        if (!url.startsWith('http')) {
          var b = new URL(base);
          this.href = url.startsWith('/')
            ? b.origin + url
            : b.origin + b.pathname.substring(0, b.pathname.lastIndexOf('/')+1) + url;
        }
      }
      var m = this.href.match(/^([^:/?#]+:)?(\/\/([^/?#]*))?([^?#]*)?(\?([^#]*))?(#(.*))?/);
      if (!m) throw new Error("Invalid URL");
      this.protocol=m[1]||""; this.host=m[3]||"";
      this.pathname=m[4]||"/"; this.search=m[5]||""; this.hash=m[7]||"";
      var hp=this.host.split(':');
      this.hostname=hp[0]; this.port=hp[1]||"";
      this.origin=this.protocol+"//"+this.host;
    }
    toString() { return this.href; }
  };

  globalThis.nativeDomBatch = function(nodeId, queries) {
    var res = sendMessage('dom_query_batch', JSON.stringify({ nodeId, queries }));
    if (typeof res === 'string') res = JSON.parse(res);
    return res || [];
  };
  globalThis.nativeExtract = function(html, extractionMap) {
    return _dartAsyncCall('dom_parse_and_extract', { html, extract: extractionMap });
  };
  globalThis.nativeRegex = function(text, pattern, group, caseSensitive) {
    var res = sendMessage('regex_match_all', JSON.stringify({
      text, pattern, group: group || 0, caseSensitive: caseSensitive !== false
    }));
    if (typeof res === 'string') res = JSON.parse(res);
    return res || [];
  };
  globalThis.nativeJsonExtract = function(jsonStr, paths) {
    var res = sendMessage('json_extract', JSON.stringify({ json: jsonStr, paths }));
    if (typeof res === 'string') res = JSON.parse(res);
    return res || {};
  };
  // JSON.stringify, because both engine bindings JSON-decode the second
  // argument unconditionally (quickjs_runtime2.dart and jscore_runtime.dart).
  // Passing a bare string meant jsonDecode('hello') threw FormatException into
  // the plugin on QuickJS and returned undefined on JavaScriptCore - and when
  // the input happened to parse as JSON it was worse than either: the handler
  // hashed Dart's Map.toString() output, so nativeMd5('{"a":1}') returned
  // md5('{a: 1}'). A confident wrong hash, silently.
  //
  // No `|| ''` fallback: an empty-string hash is a wrong answer that a plugin
  // will send to a server. Let it be undefined so the plugin can tell.
  globalThis.nativeMd5    = function(input) { return sendMessage('crypto_md5',    JSON.stringify(String(input))); };
  globalThis.nativeSha256 = function(input) { return sendMessage('crypto_sha256', JSON.stringify(String(input))); };
