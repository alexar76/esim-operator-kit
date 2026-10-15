// travel-esim in the browser: search, plan filters, checkout, the wallets (an EVM wallet signs USDC on
// Base or sends a token transfer; TronLink, Solana Pay and TON Connect for the rest), the order's
// live status and the eSIM itself.
// Values from the server reach the page through textContent and attributes only.
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("page-data").textContent);
  var prefix = D.lang === "en" ? "/" : "/" + D.lang + "/";

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") el.textContent = v; else if (k === "class") el.className = v; else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      (Array.isArray(c) ? c : [c]).forEach(function (x) { if (x != null) el.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); });
    }
    return el;
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = { "content-type": "application/json" };
    if (opts.token) headers["x-order-token"] = opts.token;
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }
  function copyButton(text, ui) {
    var b = h("button", { type: "button", class: "copy", text: ui.copy });
    b.addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () {
        b.textContent = ui.copied; setTimeout(function () { b.textContent = ui.copy; }, 1500);
      });
    });
    return b;
  }

  // ── home: the search box goes straight to a country ─────────────────────────────────────
  if (D.page === "home") {
    var q = document.getElementById("q");
    var go = function () {
      var v = q.value.trim().toLocaleLowerCase();
      var hit = D.countries.find(function (c) { return c.some(function (name) { return name.toLocaleLowerCase() === v; }); });
      document.querySelector(".search-status").hidden = !!hit || !v;
      if (hit) location.href = prefix + "c/" + hit[0].toLowerCase();
    };
    q.addEventListener("change", go);
    q.form.addEventListener("submit", function (e) { e.preventDefault(); go(); });
  }

  // ── country: filters and checkout ────────────────────────────────────────────────────────
  if (D.page === "country") {
    var form = document.querySelector(".filters");
    var plans = Array.prototype.slice.call(document.querySelectorAll(".plan"));
    var empty = document.querySelector(".empty");
    var filter = function () {
      var gb = Number(form.gb.value), days = Number(form.days.value), shown = 0;
      plans.forEach(function (p) {
        var ok = Number(p.dataset.gb) >= gb && Number(p.dataset.days) >= days;
        p.hidden = !ok; if (ok) shown++;
      });
      empty.hidden = shown > 0;
    };
    form.addEventListener("change", filter);
    var dlg = document.getElementById("checkout");
    var err = dlg.querySelector(".co-err");
    var chosen = null;
    document.querySelectorAll(".buy").forEach(function (b) {
      b.addEventListener("click", function () {
        chosen = b.dataset.offer;
        dlg.querySelector(".co-plan").textContent = b.dataset.name + " — $" + b.dataset.price;
        err.hidden = true;
        if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
      });
    });
    var note = dlg.querySelector("#m-note");
    var showNote = function () { var m = dlg.querySelector("input[name=method]:checked"); note.textContent = m ? m.dataset.note : ""; };
    dlg.addEventListener("change", showNote);
    showNote();
    dlg.querySelector("[data-close]").addEventListener("click", function () { dlg.close(); });
    var goBtn = dlg.querySelector("[data-go]");
    goBtn.addEventListener("click", function () {
      var m = dlg.querySelector("input[name=method]:checked");
      if (!m || !chosen) return;
      goBtn.disabled = true;
      api("/api/orders", { method: "POST", body: { offer_id: chosen, method: m.value } }).then(function (r) {
        if (r.status === 201) {
          try { localStorage.setItem("order:" + r.body.order.id, r.body.token); } catch (e) { /* private mode */ }
          location.href = prefix + "o/" + r.body.order.id + "#t=" + encodeURIComponent(r.body.token);
          return;
        }
        err.textContent = (D.strings.errors[r.body.error] || D.strings.errors.generic);
        // Demo mode is not a failure: say so plainly and point to the kit.
        err.classList.toggle("info", r.body.error === "demo_mode");
        if (r.body.error === "demo_mode" && D.kit_url) {
          err.appendChild(document.createTextNode(" "));
          err.appendChild(h("a", { href: D.kit_url, text: D.strings.demoCta + " →" }));
        }
        err.hidden = false;
      }).catch(function () { err.textContent = D.strings.errors.generic; err.hidden = false; })
        .then(function () { goBtn.disabled = false; });
    });
  }

  // ── order: pay, wait, install ────────────────────────────────────────────────────────────
  if (D.page !== "order") return;
  var ui = D.ui;
  var root = document.getElementById("order-body");
  var token = (location.hash.match(/t=([^&]+)/) || [])[1];
  token = token ? decodeURIComponent(token) : null;
  try {
    if (token) localStorage.setItem("order:" + D.id, token); else token = localStorage.getItem("order:" + D.id);
  } catch (e) { /* private mode */ }
  var busy = null;           // a message shown while a wallet or the server is working
  var timer = null;
  var tonUI = null;
  var lastDrawn = "";

  function show(nodes) { root.textContent = ""; (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) { if (n) root.appendChild(n); }); }
  function kv(rows) {
    var dl = h("dl", { class: "kv" });
    rows.forEach(function (r) { if (r[1] == null || r[1] === "") return; dl.appendChild(h("dt", { text: r[0] })); dl.appendChild(h("dd", null, h("span", { class: r[2] ? "code" : null, text: r[1] }), r[2] ? copyButton(String(r[1]), ui) : null)); });
    return dl;
  }
  // The supplier names plans in English; say it in the page's language, as the plan list did.
  function planLabel(off) {
    var where = off.coverage.countries.length === 1
      ? (function () { try { return new Intl.DisplayNames([D.lang === "zh" ? "zh-Hans" : D.lang], { type: "region" }).of(off.coverage.countries[0]); } catch (e) { return off.coverage.countries[0]; } })()
      : ui.region.replace("{n}", off.coverage.countries.length);
    var data = off.data_gb >= 1 ? off.data_gb + " " + ui.gb : Math.round(off.data_gb * 1024) + " MB";
    return where + " · " + data + " · " + off.days + " " + ui.days;
  }
  function gb(bytes) { return (bytes / 1073741824).toFixed(2) + " " + ui.gb; }
  function when(v) { try { return new Date(v.replace("+0000", "Z")).toLocaleString(D.lang === "zh" ? "zh-Hans" : D.lang); } catch (e) { return v; } }
  function minutesLeft(o) { return Math.max(0, Math.round((o.expires_at - Date.now()) / 60000)); }

  function render(o) {
    var head = h("p", { class: "status " + (o.status === "delivered" ? "good" : o.status === "awaiting_payment" ? "" : "bad"), text: ui.status[o.status] || o.status });
    var plan = h("p", { class: "muted", text: planLabel(o.offer) + " · $" + o.price_usd });
    if (o.status === "delivered" && o.esim) return show(h("div", { class: "panel" }, head, plan, esimView(o.esim)));
    if (o.status !== "awaiting_payment") return show(h("div", { class: "panel" }, head, plan));
    var body = busy ? h("p", null, h("span", { class: "spin" }), " ", busy) : payView(o);
    show(h("div", { class: "panel" }, head, plan, body, h("p", { class: "muted", text: ui.holds.replace("{min}", minutesLeft(o)) })));
  }

  function esimView(e) {
    var lpa = e.activation_code;
    var ios = /iPhone|iPad/.test(navigator.userAgent);
    return h("div", null,
      h("h2", { text: ui.yourEsim }),
      e.qr_code_url ? h("img", { class: "qr", src: e.qr_code_url, alt: "eSIM QR", width: "280", height: "280" }) : null,
      h("p", { text: ui.scan }),
      ios && lpa ? h("p", null, h("a", { class: "btn", href: "https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=" + encodeURIComponent(lpa), text: ui.installIphone })) : null,
      kv([[ui.activation, lpa, true], [ui.apn, e.apn, true], ["ICCID", e.iccid, true],
          [ui.usage, e.data_total_bytes ? gb(e.data_used_bytes) + " / " + gb(e.data_total_bytes) : null],
          [ui.expires, e.expires ? when(e.expires) : null]]));
  }

  function qrBox(i) {
    return i && i.qr ? h("div", { class: "qrbox" }, h("img", { src: i.qr, alt: "QR", width: "220", height: "220" }), h("small", { class: "muted", text: ui.scanQr })) : null;
  }
  function fill(t, vars) { return String(t).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ""; }); }

  function payView(o) {
    var i = o.intent || {};
    var err = h("p", { class: "err", hidden: "" });
    var fail = function (msg) { busy = null; lastDrawn = ""; err.textContent = msg; err.hidden = false; render(o); root.querySelector(".panel").appendChild(err); };
    if (o.method === "usdc-base") {
      var b = h("button", { type: "button", text: ui.connectEvm });
      b.addEventListener("click", function () { payEvm(o, fail); });
      return h("div", null, h("p", { class: "amount", text: i.amount_display }), b, h("p", { class: "muted", text: ui.methodNote["usdc-base"] }), err);
    }
    if (o.method === "evm") {
      var send = h("button", { type: "button", text: ui.payWallet });
      send.addEventListener("click", function () { payEvmTransfer(o, fail); });
      var input = h("input", { type: "text", placeholder: "0x…", autocomplete: "off", spellcheck: "false", "aria-label": ui.pasteHash });
      var check = h("button", { type: "button", class: "ghost", text: ui.checkHash });
      check.addEventListener("click", function () { claim(o, input.value, fail); });
      return h("div", null,
        h("p", { class: "amount", text: i.amount_display }),
        h("p", { class: "muted", text: ui.network + ": " + i.chain_name }),
        o.claim ? h("p", null, h("span", { class: "spin" }), " ", ui.confirming) : send,
        h("p", { class: "warn-note", text: fill(ui.sendOnly, { token: i.token, network: i.chain_name }) }),
        h("h3", { text: ui.orManual }),
        kv([[ui.to, i.to, true], [ui.amount, i.amount_display, false]]),
        qrBox(i),
        h("p", { class: "muted", text: ui.pasteHash }), h("div", { class: "hash" }, input, check), err);
    }
    if (o.method === "tron") {
      var tl = (window.tronLink || window.tronWeb) ? h("button", { type: "button", text: ui.tronLink }) : null;
      if (tl) tl.addEventListener("click", function () { payTron(o, fail); });
      return h("div", null,
        h("p", { class: "amount", text: i.amount_display }), tl,
        h("p", { class: "warn-note", text: ui.exactAmount }),
        h("p", { class: "warn-note", text: fill(ui.sendOnly, { token: "USDT", network: "Tron (TRC-20)" }) }),
        h("h3", { text: ui.orManual }),
        kv([[ui.to, i.to, true], [ui.amount, i.exact, true]]),
        qrBox(i), h("p", { class: "muted", text: ui.methodNote.tron }), err);
    }
    if (o.method === "solana") {
      return h("div", null,
        h("p", { class: "amount", text: i.amount_display }),
        h("a", { class: "btn", href: i.uri, text: ui.openSolana }),
        qrBox(i), h("p", { class: "muted", text: ui.methodNote.solana }), err);
    }
    if (o.method === "ton") {
      var holder = h("div", { id: "ton-button" });
      var pay = h("button", { type: "button", text: ui.connectTon });
      pay.addEventListener("click", function () { payTon(o, fail); });
      return h("div", null,
        h("p", { class: "amount", text: i.amount_display }),
        h("div", { class: "row" }, pay, h("a", { class: "btn ghost", href: i.deeplink, text: ui.openWallet })),
        holder,
        h("h3", { text: ui.orManual }),
        kv([[ui.to, i.to, true], [ui.amount, i.amount_display, false], [ui.comment, i.memo, true]]),
        h("p", { class: "muted", text: ui.commentRequired }), qrBox(i), err);
    }
    if (o.method === "stripe") {
      var c = h("button", { type: "button", text: ui.continue });
      c.addEventListener("click", function () {
        c.disabled = true;
        api("/api/orders/" + o.id + "/checkout", { method: "POST", token: token, body: { lang: D.lang } }).then(function (r) {
          if (r.body.redirect) location.href = r.body.redirect; else fail(ui.errors.generic);
        });
      });
      return h("div", null, h("p", { class: "amount", text: "$" + o.price_usd }), c, err);
    }
    return err;
  }

  // EVM tokens: the wallet sends transfer() on the token contract; the hash goes to the store.
  function payEvmTransfer(o, fail) {
    var eth = window.ethereum, i = o.intent, from;
    if (!eth) return fail(ui.noEvm);
    var hex = "0x" + Number(i.chain_id).toString(16);
    busy = ui.signing; lastDrawn = ""; render(o);
    eth.request({ method: "eth_requestAccounts" }).then(function (acc) {
      from = acc[0];
      return eth.request({ method: "eth_chainId" });
    }).then(function (chain) {
      if (parseInt(chain, 16) === Number(i.chain_id)) return null;
      return eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }).catch(function (e) {
        if (e && e.code === 4902 && i.rpc_public) {
          return eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: i.chain_name,
            nativeCurrency: { name: i.native, symbol: i.native, decimals: 18 }, rpcUrls: [i.rpc_public] }] });
        }
        throw new Error(ui.network + ": " + i.chain_name);
      });
    }).then(function () {
      return eth.request({ method: "eth_sendTransaction", params: [{ from: from, to: i.tx.to, data: i.tx.data, value: "0x0" }] });
    }).then(function (hash) { claim(o, hash, fail); })
      .catch(function (e) { fail((e && e.message && e.message.length < 140) ? e.message : ui.errors.generic); });
  }
  function claim(o, hash, fail) {
    busy = ui.confirming; lastDrawn = ""; render(o);
    api("/api/orders/" + o.id + "/claim", { method: "POST", token: token, body: { hash: String(hash || "").trim() } }).then(function (r) {
      if (r.body.error) return fail(ui.hashErr[r.body.error] || ui.errors.generic);
      busy = null; lastDrawn = ""; load();
    }).catch(function () { fail(ui.errors.generic); });
  }
  // USDT on Tron from TronLink: the exact amount of the order, to the store.
  function payTron(o, fail) {
    var i = o.intent;
    var req = window.tronLink && window.tronLink.request ? window.tronLink.request({ method: "tron_requestAccounts" }) : Promise.resolve();
    busy = ui.signing; lastDrawn = ""; render(o);
    req.then(function () {
      var tw = window.tronWeb;
      if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) throw new Error(ui.tronLink);
      return tw.contract().at(i.token_address);
    }).then(function (c) { return c.transfer(i.to, i.units).send({ feeLimit: 100000000 }); })
      .then(function () { busy = ui.waiting; lastDrawn = ""; render(o); poll(); })
      .catch(function (e) { fail((e && e.message && e.message.length < 140) ? e.message : ui.errors.generic); });
  }

  // USDC on Base: one EIP-712 signature; the server verifies, delivers and settles.
  function payEvm(o, fail) {
    var eth = window.ethereum;
    if (!eth) return fail(ui.noEvm);
    var from;
    busy = ui.signing; render(o);
    eth.request({ method: "eth_requestAccounts" }).then(function (acc) {
      from = acc[0];
      return eth.request({ method: "eth_chainId" });
    }).then(function (chain) {
      if (parseInt(chain, 16) === 8453) return null;
      return eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }).catch(function (e) {
        if (e && e.code === 4902) {
          return eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x2105", chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"] }] });
        }
        throw new Error(ui.wrongChain);
      });
    }).then(function () {
      var td = JSON.parse(JSON.stringify(o.intent.typed_data));
      td.message.from = from;
      return eth.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(td)] }).then(function (sig) {
        busy = ui.delivering; render(o);
        var m = td.message;
        return api("/api/orders/" + o.id + "/authorize", { method: "POST", token: token, body: {
          authorization: { from: from, to: m.to, value: m.value, validAfter: m.validAfter, validBefore: m.validBefore, nonce: m.nonce },
          signature: sig } });
      });
    }).then(function (r) {
      busy = null; lastDrawn = "";
      if (r.status === 200) return load();
      fail(ui.errors[r.body.error] || ui.errors.generic);
    }).catch(function (e) { fail((e && e.message && e.message.length < 140) ? e.message : ui.errors.generic); });
  }

  // TON: TON Connect sends TON with the memo as a comment, or USD₮ through the buyer's jetton wallet.
  function loadTonConnect() {
    if (window.TON_CONNECT_UI) return Promise.resolve();
    return new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = "/assets/tonconnect-ui.min.js"; s.onload = ok; s.onerror = no;
      document.head.appendChild(s);
    });
  }
  function payTon(o, fail) {
    busy = null;
    loadTonConnect().then(function () {
      if (!tonUI) tonUI = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: D.ton_manifest });
      var send = function (wallet) {
        var msg = o.intent.asset === "TON" ? Promise.resolve(o.intent.ton_connect)
          : api("/api/orders/" + o.id + "/ton-message", { method: "POST", token: token, body: { buyer: wallet.account.address } })
            .then(function (r) { if (!r.body.message) throw new Error(r.body.message || ui.errors.generic); return r.body.message; });
        return msg.then(function (m) { return tonUI.sendTransaction(m); }).then(function () { busy = ui.waiting; render(o); poll(); });
      };
      if (tonUI.wallet) return send(tonUI.wallet);
      var off = tonUI.onStatusChange(function (w) { if (w) { off(); send(w).catch(function (e) { fail(e && e.message ? e.message : ui.errors.generic); }); } });
      return tonUI.openModal();
    }).catch(function (e) { fail(e && e.message ? e.message : ui.errors.generic); });
  }

  function load() {
    if (!token) return show(h("p", { class: "err", text: ui.errors.generic }));
    return api("/api/orders/" + D.id, { token: token }).then(function (r) {
      if (r.status !== 200) return show(h("p", { class: "err", text: ui.errors.generic }));
      var o = r.body;
      if (o.status !== "awaiting_payment") busy = null;
      // Redraw only when something changed: a buyer may be copying the address meanwhile.
      var sig = o.status + "|" + (busy || "") + "|" + (o.claim ? o.claim.hash + o.claim.confirming : "");
      if (sig !== lastDrawn) { lastDrawn = sig; render(o); }
      // Pushed payments are found by the store; a claimed EVM transfer is confirmed by it: keep looking.
      if (o.status === "awaiting_payment" && (o.method === "ton" || o.method === "tron" || o.method === "solana" || o.claim)) poll();
    });
  }
  function poll() { clearTimeout(timer); timer = setTimeout(load, 5000); }
  load();
})();
