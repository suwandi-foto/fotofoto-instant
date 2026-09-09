import { customAlphabet, nanoid } from "nanoid";

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

// Magic-link auth tokens are never read or typed by hand, so they use
// nanoid's full default alphabet (URL-safe) at a longer length for
// unguessability (~190 bits of entropy) rather than the short
// unambiguous alphabets above.
export const generateAuthToken = () => nanoid(32);
