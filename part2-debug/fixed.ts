import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

interface BookingRequest {
  studentId: string;
  teacherId: string;
  slot: string; // ISO datetime string
  subject: string;
}

// Bug 4 (typing/security): `data: BookingRequest` was only a compile-time
// annotation. At runtime `data` is whatever the client sends over the wire —
// it is NOT guaranteed to match the interface. A malformed or malicious
// payload (missing fields, wrong types, extra fields) would pass straight
// through to Firestore with no error. We validate the shape ourselves before
// trusting anything in `data`.
function isValidBookingRequest(data: unknown): data is BookingRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.studentId === "string" &&
    typeof d.teacherId === "string" &&
    typeof d.slot === "string" &&
    typeof d.subject === "string" &&
    !Number.isNaN(Date.parse(d.slot))
  );
}

// The handler must be declared `async` because we now properly `await`
// the Firestore read and write below (see bugs 1 and 2).
export const bookSession = functions.https.onCall(async (data: unknown, context) => {
  // Bug 3 (security): the original function never checked `context.auth`,
  // so an unauthenticated caller could invoke it directly, and there was
  // nothing stopping a caller from booking a session under a `studentId`
  // that wasn't their own (identity spoofing). We require the caller to be
  // signed in, and force studentId to be the authenticated uid rather than
  // trusting whatever the client sends.
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be signed in to book a session."
    );
  }

  if (!isValidBookingRequest(data)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Booking request is missing or has malformed fields."
    );
  }

  const studentId = context.auth.uid; // trust the token, not the payload
  const { teacherId, slot, subject } = data;

  const booking = {
    studentId,
    teacherId,
    slot,
    subject,
    status: "confirmed",
    createdAt: new Date(),
  };

  const teacherRef = db.collection("teachers").doc(teacherId);

  // Bug 1 (async/await): `.get()` returns a Promise<QuerySnapshot>, not a
  // snapshot. The original code read `existing.docs` off the Promise itself,
  // which is `undefined` — this throws a TypeError at runtime and the
  // double-booking check never actually executes. We must `await` it.
  const existing = await teacherRef
    .collection("bookings")
    .where("slot", "==", slot)
    .get();

  if (!existing.empty) {
    return { success: false, message: "Slot already booked" };
  }

  // Bug 2 (async/await): the original code fired `.add()` without awaiting
  // it, then immediately returned `{ success: true }`. If the write failed
  // (permissions, network blip, quota), the client would still be told it
  // succeeded — a silent data-loss bug. We await it and let failures throw.
  await db.collection("bookings").add(booking);

  return { success: true };
});
