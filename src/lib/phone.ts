export function formatUsPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function toUsPhoneE164(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!digits) return "";
  if (digits.length !== 10) throw new Error("Enter a 10-digit phone number.");
  return `+1${digits}`;
}
