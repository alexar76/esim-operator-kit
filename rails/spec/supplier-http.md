# HTTP supplier — the contract

Version 1. The kit calls these five endpoints of the operator's own system when it runs with
`SUPPLIER=http`. Implement them in any language; `examples/operator-backend.mjs` is a working
reference. JSON Schemas: `esim-v1/supplier-plan.schema.json`, `esim-v1/supplier-profile.schema.json`.

## Transport

- Base URL: `SUPPLIER_URL`, for example `https://ops.example.com/esim`. Paths below are appended to it.
- Requests with a body send `content-type: application/json`. Answers are JSON.
- Every request is signed with the shared secret in `SUPPLIER_SECRET_FILE` (16 characters or more):

```text
X-Kit-Timestamp: 1765432100000                                   milliseconds since the epoch
X-Kit-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + METHOD + " " + path + "." + body)>
```

`path` is the request path with its query string, exactly as sent (for example
`/esim/profiles?order_ref=ORD-1`). `body` is the raw request body, empty for GET. Refuse a request
whose signature does not match or whose timestamp is more than five minutes from your clock.

## Endpoints

| Method and path | Body | Answer |
|---|---|---|
| `GET /catalog` | — | `{"plans": [Plan]}` |
| `POST /orders` | `{"transaction_id", "plan_id", "cost_usd"}` | `{"order_ref"}` |
| `GET /profiles?order_ref=…` or `?profile_id=…` | — | `{"profiles": [Profile]}` |
| `POST /profiles/{profile_id}/cancel` | `{}` | `{"cancelled": true}` |
| `GET /balance` | — | `{"usd": 250.0}`, or HTTP 404 when there is no balance to watch |

**Plan**: `id`, `name`, `countries` (ISO 3166-1 alpha-2), `kind` (`country`, `region` or `global`),
`data_bytes`, `days`, `cost_usd` (your cost, never shown to buyers); optional `speed`, `networks`,
`top_up`, `unused_valid_days`.

**Profile**: `profile_id` (6–64 letters, digits, `_` or `-`), `order_ref`, `activation_code`
(`LPA:1$…`); optional `iccid`, `qr_code_url`, `install_url`, `apn`, `expires`, `state`,
`installed`, `data_used_bytes`, `data_total_bytes`, `activated`.

## Rules

1. **`POST /orders` is idempotent by `transaction_id`.** The same id again returns the same
   `order_ref` and never makes a second profile. The kit derives the id from the buyer's payment,
   so this is what makes one payment buy one eSIM.
2. **`cost_usd` is the cost the kit quoted at.** If the plan's cost has changed since, refuse with
   409 `price_changed`. A refusal is never charged to the buyer.
3. **`GET /profiles?order_ref=…` returns `[]` while the profile is being made.** The kit polls for
   up to 45 seconds, then tells the buyer to retry with the same payment.
4. **Cancel only unused profiles.** A profile already installed answers 409 `in_use`.
5. **Errors** are `{"error": "<code>", "message": "…", "retryable": false}` with an HTTP status.
   `retryable: true`, 429 or any 5xx means "not now"; anything else means "no".

## Verifying the signature

Node.js: `import { verifySupplierRequest } from "@aimarket/esim-rails/http-supplier"`.

Python:

```python
import hashlib, hmac, time

def kit_request_ok(secret: bytes, timestamp: str, signature: str, method: str, path: str, body: bytes) -> bool:
    if abs(time.time() * 1000 - int(timestamp)) > 5 * 60 * 1000:
        return False
    msg = f"{timestamp}.{method.upper()} {path}.".encode() + body
    want = "v1=" + hmac.new(secret, msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, signature)
```

Go:

```go
func kitRequestOK(secret []byte, ts, sig, method, path string, body []byte) bool {
	ms, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || math.Abs(float64(time.Now().UnixMilli()-ms)) > 5*60*1000 {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(ts + "." + strings.ToUpper(method) + " " + path + "."))
	mac.Write(body)
	want := "v1=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(sig))
}
```
