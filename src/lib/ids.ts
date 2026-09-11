import { customAlphabet } from "nanoid";

// Unambiguous alphabet (no 0/O, 1/I/l) since event slugs may get typed
// in manually if a QR scan fails.
const slugAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const generateSlug = customAlphabet(slugAlphabet, 7);

const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
export const generateId = customAlphabet(idAlphabet, 16);

// Same unambiguous alphabet as generateSlug — a referral voucher code
// may get read aloud or typed in by hand, same failure mode as a slug.
const generateVoucherSuffix = customAlphabet(slugAlphabet, 5);
export const generateVoucherCode = () => `FOTO-REF-${generateVoucherSuffix()}`;

// Client access codes are staff-issued over WhatsApp/etc. and typed
// back in by the client, so — same reasoning as generateSlug above —
// they use the unambiguous alphabet, at a length that's still easy to
// read and type over chat.
export const generateAccessCode = customAlphabet(slugAlphabet, 7);
