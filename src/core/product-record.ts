import { z } from "zod";

const unknownValueSchema = z.literal("unknown");

function isCanonicalIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const knownFactTextSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value !== "unknown", "Expected a known fact.");
const sourceUrlSchema = z.string().url().refine(isHttpUrl, "Expected an HTTP(S) URL.");
const capturedAtSchema = z
  .string()
  .refine(isCanonicalIsoTimestamp, "Expected a canonical ISO timestamp.");

export const ProductRecordSchema = z
  .object({
    id: z.string().uuid(),
    capturedAt: capturedAtSchema,
    source: z
      .object({
        url: sourceUrlSchema,
        pageTitle: z.string(),
      })
      .strict(),
    name: z.union([knownFactTextSchema, unknownValueSchema]),
    brand: z.union([knownFactTextSchema, unknownValueSchema]),
    price: z.union([
      z
        .object({
          amount: z.number().finite().nonnegative(),
          currency: knownFactTextSchema,
        })
        .strict(),
      unknownValueSchema,
    ]),
    category: z.union([knownFactTextSchema, unknownValueSchema]),
    specs: z
      .array(
        z
          .object({
            label: knownFactTextSchema,
            value: knownFactTextSchema,
          })
          .strict(),
      )
      .readonly(),
    pros: z.array(knownFactTextSchema).readonly(),
    cons: z.array(knownFactTextSchema).readonly(),
    extraction: z
      .object({
        method: z.enum(["json-ld", "dom-fallback"]),
        model: knownFactTextSchema,
      })
      .strict(),
  })
  .strict()
  .readonly();

export type ProductRecord = z.infer<typeof ProductRecordSchema>;
