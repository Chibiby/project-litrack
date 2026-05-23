import { z } from "zod";

export const nonEmpty = (msg = "Required") => z.string().trim().min(1, msg);
export const email = z.string().email("Invalid email address");
export const optionalString = z.string().trim().optional().or(z.literal("").transform(() => undefined));
