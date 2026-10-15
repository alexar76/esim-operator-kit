// Google Sheets as an order book for the kit: every webhook event becomes a row.
//
// 1. In a Google Sheet: Extensions → Apps Script, paste this file, set TOKEN below to a long random string.
// 2. Deploy → New deployment → Web app → Execute as: me, Who has access: Anyone. Copy the /exec URL.
// 3. In the kit's .env: WEBHOOK_URL=<that URL>?token=<TOKEN>  (and any 16+ character secret in secrets/webhook_secret).
//
// Apps Script cannot read request headers, so it cannot check the kit's HMAC signature: the token in the
// URL is what keeps strangers out. Use the relay (webhook-relay.mjs) in front of it if you need the signature.
const TOKEN = "replace-with-a-long-random-string";

function doPost(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) return ContentService.createTextOutput("forbidden");
  const event = JSON.parse(e.postData.contents);
  const d = event.data || {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("orders") || SpreadsheetApp.getActiveSpreadsheet().insertSheet("orders");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["received", "event id", "type", "order", "offer", "price USD", "cost USD", "method", "payment ref", "payer", "eSIM", "error"]);
  }
  // At-least-once delivery: skip an event id already in the sheet.
  const ids = sheet.getRange(1, 2, Math.max(sheet.getLastRow(), 1), 1).getValues().map((r) => r[0]);
  if (ids.indexOf(event.id) >= 0) return ContentService.createTextOutput("duplicate");
  sheet.appendRow([new Date(), event.id, event.type, d.order_id || "", d.offer_id || "", d.price_usd || "", d.cost_usd || "",
                   d.method || "", (d.payment && d.payment.ref) || d.payment_ref || "", (d.payment && d.payment.payer) || d.payer || "",
                   d.esim_tran_no || "", d.error || ""]);
  return ContentService.createTextOutput("ok");
}
