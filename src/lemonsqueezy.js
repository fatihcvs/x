// LemonSqueezy Webhook & Checkout entegrasyonu
// Docs: https://docs.lemonsqueezy.com/guides/developer-guide/webhooks
//
// .env'de gerekli değişkenler:
//   LEMONSQUEEZY_WEBHOOK_SECRET  — LemonSqueezy webhook signing secret
//   LEMONSQUEEZY_PRO_VARIANT_ID  — Pro paket variant ID'si
//   LEMONSQUEEZY_PREMIUM_VARIANT_ID — Premium paket variant ID'si
//   LEMONSQUEEZY_PRO_CHECKOUT_URL — Pro paket checkout linki
//   LEMONSQUEEZY_PREMIUM_CHECKOUT_URL — Premium paket checkout linki

const crypto = require("crypto");
const db = require("./db");

const WEBHOOK_SECRET = () => process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "";

// Variant ID → plan eşleştirmesi (LemonSqueezy panelinden alınacak)
function variantToPlan(variantId) {
  const vid = String(variantId);
  if (vid === String(process.env.LEMONSQUEEZY_PRO_VARIANT_ID)) return "pro";
  if (vid === String(process.env.LEMONSQUEEZY_PREMIUM_VARIANT_ID)) return "premium";
  return null;
}

// İmza doğrulaması (HMAC-SHA256)
function verifySignature(rawBody, signature) {
  const secret = WEBHOOK_SECRET();
  if (!secret) {
    console.warn("[lemonsqueezy] WEBHOOK_SECRET tanımlı değil, imza kontrolü atlanıyor.");
    return true; // Geliştirme ortamında geç
  }
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Webhook handler — Express route olarak kullanılır
function handleWebhook(req, res) {
  const signature = req.headers["x-signature"] || "";
  const rawBody = req.rawBody; // express.json ile rawBody middleware'i gerekli

  if (!verifySignature(rawBody, signature)) {
    console.error("[lemonsqueezy] Geçersiz webhook imzası!");
    return res.status(403).json({ ok: false, error: "Invalid signature" });
  }

  const payload = req.body;
  const eventName = (payload.meta && payload.meta.event_name) || "";
  const customData = (payload.meta && payload.meta.custom_data) || {};
  const attrs = (payload.data && payload.data.attributes) || {};

  console.log(`[lemonsqueezy] Webhook alındı: ${eventName}`);

  // custom_data içinde user_id bekliyoruz (checkout URL'ine eklenir)
  const userId = customData.user_id ? Number(customData.user_id) : null;
  const customerEmail = attrs.user_email || "";
  const variantId = attrs.variant_id || (attrs.first_subscription_item && attrs.first_subscription_item.variant_id);

  switch (eventName) {
    case "subscription_created":
    case "subscription_updated":
    case "subscription_resumed":
    case "subscription_payment_success": {
      const plan = variantToPlan(variantId);
      let targetUserId = userId;

      // user_id custom_data'da yoksa email ile bul
      if (!targetUserId && customerEmail) {
        const user = db.getUser(customerEmail);
        if (user) targetUserId = user.id;
      }

      if (!targetUserId) {
        console.warn("[lemonsqueezy] Kullanıcı bulunamadı:", { customerEmail, userId });
        return res.json({ ok: true, action: "user_not_found" });
      }

      if (plan) {
        db.updateUserPlan(targetUserId, plan);
        // LemonSqueezy müşteri ID'sini kaydet
        const customerId = payload.data && payload.data.id;
        if (customerId) {
          db.setMeta(targetUserId, "lemonCustomerId", String(customerId));
        }
        const subscriptionId = attrs.subscription_id || (payload.data && payload.data.id);
        if (subscriptionId) {
          db.setMeta(targetUserId, "lemonSubscriptionId", String(subscriptionId));
        }
        console.log(`[lemonsqueezy] Kullanıcı #${targetUserId} → ${plan.toUpperCase()} paketine yükseltildi.`);
      }
      break;
    }

    case "subscription_cancelled":
    case "subscription_expired":
    case "subscription_paused": {
      let targetUserId = userId;
      if (!targetUserId && customerEmail) {
        const user = db.getUser(customerEmail);
        if (user) targetUserId = user.id;
      }
      if (targetUserId) {
        db.updateUserPlan(targetUserId, "free");
        console.log(`[lemonsqueezy] Kullanıcı #${targetUserId} → FREE paketine düşürüldü (abonelik iptal/süre doldu).`);
      }
      break;
    }

    default:
      console.log(`[lemonsqueezy] Bilinmeyen event: ${eventName}`);
  }

  res.json({ ok: true });
}

// Checkout URL oluşturma (kullanıcıyı LemonSqueezy ödeme sayfasına yönlendirir)
function getCheckoutUrl(plan, userId, userEmail) {
  const baseUrl = plan === "pro"
    ? process.env.LEMONSQUEEZY_PRO_CHECKOUT_URL
    : process.env.LEMONSQUEEZY_PREMIUM_CHECKOUT_URL;

  if (!baseUrl) return null;

  // Custom data olarak user_id ekle (webhook'ta geri alacağız)
  const url = new URL(baseUrl);
  url.searchParams.set("checkout[custom][user_id]", String(userId));
  if (userEmail) {
    url.searchParams.set("checkout[email]", userEmail);
  }
  return url.toString();
}

module.exports = {
  handleWebhook,
  getCheckoutUrl,
  verifySignature
};
