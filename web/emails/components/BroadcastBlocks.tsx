import * as React from "react";
import { Hr, Img, Link, Section, Text } from "react-email";
import { emailBrand } from "../brand";
import { FlaimText } from "./FlaimEmailLayout";

/**
 * Reusable blocks for product-update Broadcasts. Order: hero, note, try-this,
 * buttons, league report. The human voice leads; product details sit lower in
 * quieter type. The big headline is the layout `title`, which renders above
 * the hero, so the hero itself is only the GIF.
 */

export function BroadcastHero({
  alt = "",
  gifUrl,
}: {
  alt?: string;
  gifUrl?: string;
}) {
  if (!gifUrl) return null;

  return (
    <Section style={styles.hero}>
      <Img alt={alt} src={gifUrl} style={styles.gif} width="512" />
    </Section>
  );
}

/** The personal note. Short paragraphs in Gerry's voice, signed at the end. */
export function GerryNote({ paragraphs }: { paragraphs: React.ReactNode[] }) {
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <FlaimText key={index}>{paragraph}</FlaimText>
      ))}
      <Text style={styles.signature}>Gerry</Text>
    </>
  );
}

/** A small callout with one prompt the reader can paste into their assistant. */
export function TryThis({ prompt }: { prompt: string }) {
  return (
    <Section style={styles.tryThis}>
      <Text style={styles.label}>TRY THIS</Text>
      <Text style={styles.prompt}>{`“${prompt}”`}</Text>
    </Section>
  );
}

/** Thin divider plus the lead-in for the quieter details below it. */
export function ReportHeader({
  intro = "The details, for those who want them.",
  title = "THE LEAGUE REPORT",
}: {
  intro?: string;
  title?: string;
}) {
  return (
    <>
      <Hr style={styles.divider} />
      <Text style={styles.reportTitle}>{title}</Text>
      <Text style={styles.reportIntro}>{intro}</Text>
    </>
  );
}

/**
 * A labeled list of one-line items. The default tone is quiet (smaller, muted).
 * Use tone="normal" for anything the reader must not skim past, such as a
 * legal or privacy notice.
 */
export function ReportSection({
  items,
  label,
  tone = "quiet",
}: {
  items: React.ReactNode[];
  label: string;
  tone?: "quiet" | "normal";
}) {
  const listStyle = tone === "normal" ? styles.listNormal : styles.listQuiet;

  return (
    <Section style={styles.reportSection}>
      <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
      <ul style={listStyle}>
        {items.map((item, index) => (
          <li key={index} style={styles.item}>
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function ReportLink({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link href={href} style={styles.link}>
      {children}
    </Link>
  );
}

const label = {
  color: emailBrand.colors.mutedForeground,
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  lineHeight: "18px",
} as const;

const styles = {
  hero: {
    margin: "0 0 20px",
  },
  gif: {
    borderRadius: emailBrand.radius.card,
    display: "block",
    height: "auto",
    margin: "0",
    maxWidth: "100%",
    width: "100%",
  },
  signature: {
    color: emailBrand.colors.foreground,
    fontSize: "15px",
    fontWeight: "600",
    lineHeight: "24px",
    margin: "0 0 20px",
  },
  tryThis: {
    backgroundColor: emailBrand.colors.muted,
    borderColor: emailBrand.colors.border,
    borderRadius: emailBrand.radius.card,
    borderStyle: "solid",
    borderWidth: "1px",
    margin: "0 0 20px",
    padding: "14px 16px",
  },
  label: {
    ...label,
    margin: "0 0 4px",
  },
  prompt: {
    color: emailBrand.colors.foreground,
    fontSize: "16px",
    fontWeight: "600",
    lineHeight: "24px",
    margin: "0",
  },
  divider: {
    borderColor: emailBrand.colors.border,
    margin: "12px 0 20px",
  },
  reportTitle: {
    ...label,
    color: emailBrand.colors.foreground,
    margin: "0 0 2px",
  },
  reportIntro: {
    color: emailBrand.colors.mutedForeground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "0 0 20px",
  },
  reportSection: {
    margin: "0 0 16px",
  },
  sectionLabel: {
    ...label,
    margin: "0 0 4px",
  },
  listQuiet: {
    color: emailBrand.colors.mutedForeground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "0",
    paddingLeft: "18px",
  },
  listNormal: {
    color: emailBrand.colors.foreground,
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0",
    paddingLeft: "18px",
  },
  item: {
    margin: "0 0 4px",
    paddingLeft: "2px",
  },
  link: {
    color: emailBrand.colors.foreground,
    textDecoration: "underline",
  },
} as const;
