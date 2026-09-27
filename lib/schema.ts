import { z } from "zod";

/** Roles and packages, ported from the Onboarding mockup. */
export const ROLES = [
  { id: "user", th: "ผู้ใช้งานทั่วไป", en: "Default User", dth: "ดูข้อมูลรถ สถานะแบตเตอรี่ และรายงาน", den: "View vehicles, battery status and reports" },
  { id: "exec", th: "ผู้บริหาร", en: "Executive", dth: "ดูภาพรวม Fleet และรายงานสำหรับผู้บริหาร", den: "Fleet overview and executive reports" },
  { id: "driver", th: "พนักงานขับรถ", en: "Driver", dth: "ดูรถที่ได้รับมอบหมาย และแจ้งปัญหา", den: "Assigned vehicle and issue reporting" },
] as const;

export const PKGS = [
  { id: "starter", name: "Starter", price: "฿290", lth: "สูงสุด 3 คัน", len: "Up to 3 vehicles", fth: ["ติดตามรถแบบเรียลไทม์", "แจ้งเตือนสุขภาพแบตเตอรี่", "ผู้ใช้ 3 บัญชี"], fen: ["Real-time tracking", "Battery health alerts", "3 user accounts"] },
  { id: "standard", name: "Standard", price: "฿390", lth: "สูงสุด 20 คัน", len: "Up to 20 vehicles", fth: ["ทุกอย่างใน Starter", "รายงาน PDF / Excel", "ผู้ใช้ 10 บัญชี"], fen: ["Everything in Starter", "PDF / Excel reports", "10 user accounts"] },
  { id: "plus", name: "Plus", price: "฿490", lth: "สูงสุด 30 คัน", len: "Up to 30 vehicles", fth: ["ทุกอย่างใน Standard", "แดชบอร์ดผู้บริหาร", "เชื่อมต่ออู่ซ่อมเครือข่าย", "ประกันภัยรถยนต์"], fen: ["Everything in Standard", "Executive dashboard", "Partner garage network", "Vehicle insurance"] },
  { id: "premium", name: "Premium", price: null, lth: "ไม่จำกัดจำนวนรถ", len: "Unlimited vehicles", fth: ["ทุกอย่างใน Plus", "API และการเชื่อมต่อระบบ", "ติดตามตำแหน่งด้วย GPS", "แดชบอร์ดวิเคราะห์ข้อมูลขั้นสูง"], fen: ["Everything in Plus", "API & integrations", "GPS tracking", "Powerful analytics dashboard"] },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];
export type PkgId = (typeof PKGS)[number]["id"];

/** Error codes; the UI maps them to Thai/English messages. */
export type ErrCode = "req" | "phone" | "email" | "pkg" | "pdpa" | "long";

const text = (max: number) =>
  z
    .string({ required_error: "req" })
    .trim()
    .min(1, "req")
    .max(max, "long");

/** Registration fields: exactly what the user fills in. */
export const registrationSchema = z.object({
  company: text(150),
  nameTh: text(120),
  nameEn: text(120),
  phone: z
    .string({ required_error: "req" })
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.string().min(1, "req").regex(/^0\d{9}$/, "phone")),
  email: z
    .string()
    .trim()
    .max(200, "long")
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "email")
    .default(""),
  role: z.enum(["user", "exec", "driver"], { errorMap: () => ({ message: "req" }) }),
  pkg: z.enum(["starter", "standard", "plus", "premium"], { errorMap: () => ({ message: "pkg" }) }),
  pdpa: z.literal(true, { errorMap: () => ({ message: "pdpa" }) }),
  lang: z.enum(["th", "en"]).default("th"),
});

export type RegistrationInput = z.input<typeof registrationSchema>;
export type Registration = z.output<typeof registrationSchema>;

/** Full request body: fields + proofs that the server verifies. */
export const requestSchema = registrationSchema.extend({
  idToken: z.string().min(10),
  turnstileToken: z.string().min(1),
});

/** Flatten zod issues into { field: code } for the form. */
export function fieldErrors(err: z.ZodError): Record<string, ErrCode> {
  const out: Record<string, ErrCode> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = (issue.message as ErrCode) || "req";
  }
  return out;
}
