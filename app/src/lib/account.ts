// Accounts, as far as the app can go without a backend: sign-in providers return the demo
// account, and Create account validates the form locally. Nothing leaves the device.

export type Account = {
  name: string;
  username: string;
  email: string;
  /** YYYY-MM-DD, only used to unlock 21+ deals. */
  birthday: string | null;
  /** Domain of a verified .edu email, e.g. "ucla.edu". */
  studentDomain: string | null;
};

/** What "Continue with Apple / Google / phone" signs in as until there is an auth backend. */
export const DEMO_ACCOUNT: Account = {
  name: 'Maya Rodriguez',
  username: 'mayasaves',
  email: 'maya@ucla.edu',
  birthday: '2004-03-14',
  studentDomain: 'ucla.edu',
};

/** Shown for an account with no name yet (backend: no Clerk name, e.g. phone sign-up). */
export const NO_NAME = 'dibs user';

const TAKEN_USERNAMES = new Set(['dibs', 'admin', 'support', 'kevint', 'sofiam']);

export function isUsernameValid(username: string) {
  return /^[a-z0-9_.]{3,20}$/.test(username);
}

export function isUsernameAvailable(username: string) {
  return isUsernameValid(username) && !TAKEN_USERNAMES.has(username);
}

export function isEmailValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** "maya@ucla.edu" → "ucla.edu"; null for non-.edu addresses. */
export function eduDomain(email: string) {
  const match = email
    .trim()
    .toLowerCase()
    .match(/@([a-z0-9-]+\.)*([a-z0-9-]+\.edu)$/);
  return match ? match[2] : null;
}

/** "ucla.edu" → "UCLA" */
export function schoolName(domain: string) {
  return domain.replace(/\.edu$/, '').toUpperCase();
}

const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/** 0–4 bars: length, then mixed case, digits and symbols each add one. */
export function passwordStrength(password: string) {
  if (password.length < 8) return { score: 0, label: STRENGTH_LABELS[0] };
  const score = Math.min(
    4,
    1 +
      [/[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(
        Boolean,
      ).length,
  );
  return { score, label: STRENGTH_LABELS[score] };
}

/** Keeps typed digits as "MM / DD / YYYY". */
export function formatBirthdayInput(text: string) {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join(' / ');
}

/** "03 / 14 / 2004" → "2004-03-14", or null if it isn't a real past date. */
export function parseBirthday(text: string) {
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const [mm, dd, yyyy] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const real = date.getMonth() === Number(mm) - 1 && date.getDate() === Number(dd);
  return real && date < new Date() ? `${yyyy}-${mm}-${dd}` : null;
}

export function ageOn(birthday: string, now = new Date()) {
  const [y, m, d] = birthday.split('-').map(Number);
  const hadBirthday = now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  return now.getFullYear() - y - (hadBirthday ? 0 : 1);
}

/** "Maya Rodriguez" → "MR" */
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** "Maya Rodriguez" → "Maya R." */
export function shortName(name: string) {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}
