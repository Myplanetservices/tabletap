/* TableTap — plan checkout page (get-access.html).
   The form goes to /api/pay, which creates the Razorpay order with the price
   from the server. Razorpay Checkout takes the payment; the browser then asks
   /api/pay to verify it, which creates the owner invite and emails the link. */

const API = new URL('../../api/pay', import.meta.url).href;
const $ = (id) => document.getElementById(id);

const form = $('buy-form');
const errorEl = $('buy-error');
const submit = $('buy-submit');
const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');

let catalog = null;

function showError(text) {
  errorEl.textContent = text;
  errorEl.hidden = !text;
}

function selectedPlan() {
  return form.querySelector('input[name="plan"]:checked').value;
}

function updateTotal() {
  const plan = catalog && catalog.plans[selectedPlan()];
  if (plan) $('buy-total').textContent = rupees(plan.inr);
}

async function loadCatalog() {
  try {
    const res = await fetch(API);
    catalog = await res.json();
    for (const [id, plan] of Object.entries(catalog.plans || {})) {
      const el = document.querySelector(`[data-price="${id}"]`);
      if (el) el.textContent = rupees(plan.inr);
    }
    const wanted = new URLSearchParams(location.search).get('plan');
    const radio = wanted && form.querySelector(`input[name="plan"][value="${CSS.escape(wanted)}"]`);
    if (radio) radio.checked = true;
    updateTotal();
    if (!catalog.configured) showError('Online payment is not switched on yet. Email hello@tabletap.app and we will set you up.');
  } catch (_) {
    showError('Could not reach the payment service. Check your connection and reload.');
  }
}

async function post(body) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function showSuccess(result, email) {
  const sent = result.emailStatus === 'sent';
  $('buy-success-text').textContent = sent
    ? `Your access link is on its way to ${email}. Open it, choose a password and your dashboard is ready. Check spam if it has not arrived in a minute.`
    : `Your payment went through, but we could not send the email to ${email} just now. Write to hello@tabletap.app and we will send your access link by hand.`;
  document.querySelector('[data-buy-form]').hidden = true;
  const box = document.querySelector('[data-buy-success]');
  box.hidden = false;
  if (window.lucide) window.lucide.createIcons();
  box.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

form.addEventListener('change', updateTotal);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const data = Object.fromEntries(new FormData(form).entries());
  const need = ['restaurant', 'ownerName', 'country', 'city', 'email'];
  if (need.some((k) => !String(data[k] || '').trim())) return showError('Fill in the restaurant, your name, country, city and email.');
  if (!/^\S+@\S+\.\S+$/.test(data.email.trim())) return showError('That email address does not look right.');
  if (!$('agree').checked) return showError('Tick the box to continue.');
  if (!window.Razorpay) return showError('The payment window could not load. Disable ad blockers for this page and reload.');

  submit.disabled = true;
  submit.textContent = 'Opening payment…';
  try {
    const order = await post({
      action: 'order', planId: data.plan, restaurant: data.restaurant, ownerName: data.ownerName,
      email: data.email, country: data.country, city: data.city, phone: data.phone || '',
    });
    const plan = catalog.plans[data.plan];
    const checkout = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'TableTap',
      description: `${plan.name} — ${data.restaurant}`,
      prefill: { name: data.ownerName, email: data.email.trim(), contact: data.phone || '' },
      notes: { restaurant: data.restaurant },
      theme: { color: '#1B3FD8' },
      modal: {
        ondismiss: () => { submit.disabled = false; submit.textContent = 'Pay and get access'; },
      },
      handler: async (response) => {
        submit.textContent = 'Confirming payment…';
        try {
          const result = await post({ action: 'verify', ...response });
          showSuccess(result, result.email || data.email.trim());
        } catch (err) {
          submit.disabled = false;
          submit.textContent = 'Pay and get access';
          showError(`We could not confirm your payment (${response.razorpay_payment_id}). If money left your account, write to hello@tabletap.app with this payment id.`);
        }
      },
    });
    checkout.on('payment.failed', (r) => {
      submit.disabled = false;
      submit.textContent = 'Pay and get access';
      showError((r.error && r.error.description) || 'The payment failed. You have not been charged. Please try again.');
    });
    checkout.open();
  } catch (err) {
    submit.disabled = false;
    submit.textContent = 'Pay and get access';
    showError(err.message);
  }
});

loadCatalog();
