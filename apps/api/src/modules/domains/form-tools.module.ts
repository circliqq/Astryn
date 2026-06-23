import { BadRequestException, Controller, Get, Module, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";

interface DetectedField {
  label: string;
  fieldName: string;
  required: boolean;
  type: string;
}

@Controller("form-tools")
@UseGuards(AuthGuard)
class FormToolsController {
  @Get("google-fields")
  async googleFields(@Query("url") rawUrl?: string) {
    if (!rawUrl) throw new BadRequestException("Form URL is required.");

    const url = normalizeGoogleFormUrl(rawUrl);
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 AstrynBulkForms/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new BadRequestException(`Could not load form (${response.status}).`);
    }

    const html = await response.text();
    const fields = extractGoogleFormFields(html);
    if (fields.length === 0) {
      throw new BadRequestException("No Google Form fields detected. Make sure the form is public.");
    }

    return {
      actionUrl: url.replace("/viewform", "/formResponse").replace(/\/viewform\?.*$/, "/formResponse"),
      fields,
    };
  }
}

function normalizeGoogleFormUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new BadRequestException("Invalid form URL.");
  }

  if (!/(^|\.)docs\.google\.com$/i.test(parsed.hostname)) {
    throw new BadRequestException("Only Google Forms links can be auto-detected.");
  }

  if (!parsed.pathname.includes("/forms/")) {
    throw new BadRequestException("This does not look like a Google Form link.");
  }

  parsed.pathname = parsed.pathname.replace("/formResponse", "/viewform");
  parsed.search = "";
  return parsed.toString();
}

function extractGoogleFormFields(html: string): DetectedField[] {
  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*<\/script>/s);
  if (!match?.[1]) return fallbackExtractFields(html);

  try {
    const data = JSON.parse(match[1]) as unknown;
    const fields = new Map<string, DetectedField>();
    walkGoogleData(data, fields);
    return [...fields.values()];
  } catch {
    return fallbackExtractFields(html);
  }
}

function walkGoogleData(node: unknown, fields: Map<string, DetectedField>) {
  if (!Array.isArray(node)) return;

  const label = typeof node[1] === "string" ? cleanLabel(node[1]) : "";
  const controls = node[4];
  if (label && Array.isArray(controls)) {
    for (const control of controls) {
      if (!Array.isArray(control)) continue;
      const id = typeof control[0] === "number" ? control[0] : null;
      if (id == null) continue;
      const fieldName = `entry.${id}`;
      if (!fields.has(fieldName)) {
        fields.set(fieldName, {
          label,
          fieldName,
          required: Boolean(control[2]),
          type: typeof node[3] === "number" ? String(node[3]) : "text",
        });
      }
    }
  }

  for (const child of node) walkGoogleData(child, fields);
}

function fallbackExtractFields(html: string): DetectedField[] {
  const fields = new Map<string, DetectedField>();
  for (const match of html.matchAll(/name="(entry\.\d+)"/g)) {
    const fieldName = match[1];
    if (fieldName && !fields.has(fieldName)) {
      fields.set(fieldName, { label: fieldName, fieldName, required: false, type: "text" });
    }
  }
  return [...fields.values()];
}

function cleanLabel(label: string) {
  return label.replace(/\s+/g, " ").trim();
}

@Module({ controllers: [FormToolsController] })
export class FormToolsModule {}
