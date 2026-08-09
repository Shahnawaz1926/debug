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


export const bookSession = functions.https.onCall(async (data: unknown, context) => {
  
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

  const studentId = context.auth.uid; 
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

  const existing = await teacherRef
    .collection("bookings")
    .where("slot", "==", slot)
    .get();

  if (!existing.empty) {
    return { success: false, message: "Slot already booked" };
  }

  await db.collection("bookings").add(booking);

  return { success: true };
});