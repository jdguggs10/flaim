import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { emailBrand } from "../brand";

interface FlaimEmailLayoutProps {
  children: React.ReactNode;
  eyebrow?: string;
  preview: string;
  title: string;
}

interface FlaimButtonProps {
  children: React.ReactNode;
  href: string;
}

export function FlaimEmailLayout({
  children,
  eyebrow,
  preview,
  title,
}: FlaimEmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Link href={emailBrand.url} style={styles.wordmark}>
              Flaim
            </Link>
          </Section>

          <Section style={styles.card}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Heading as="h1" style={styles.heading}>
              {title}
            </Heading>
            {children}
          </Section>

          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              Flaim connects your real fantasy leagues to your AI assistant for
              read-only, league-specific analysis.
            </Text>
            <Text style={styles.footerText}>
              Need help? Email{" "}
              <Link href={`mailto:${emailBrand.supportEmail}`} style={styles.footerLink}>
                {emailBrand.supportEmail}
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function FlaimButton({ children, href }: FlaimButtonProps) {
  return (
    <Button href={href} style={styles.button}>
      {children}
    </Button>
  );
}

export function FlaimText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

export function FlaimMutedText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.mutedText}>{children}</Text>;
}

export function FlaimDivider() {
  return <Hr style={styles.divider} />;
}

export function FlaimCallout({ children }: { children: React.ReactNode }) {
  return <Section style={styles.callout}>{children}</Section>;
}

export const styles = {
  body: {
    backgroundColor: emailBrand.colors.background,
    color: emailBrand.colors.foreground,
    fontFamily: emailBrand.fontFamily,
    margin: "0",
    padding: "0",
  },
  container: {
    margin: "0 auto",
    maxWidth: "560px",
    padding: "32px 16px",
  },
  header: {
    padding: "0 0 16px",
  },
  wordmark: {
    color: emailBrand.colors.foreground,
    fontSize: "18px",
    fontWeight: "700",
    lineHeight: "24px",
    textDecoration: "none",
  },
  card: {
    backgroundColor: emailBrand.colors.card,
    border: `1px solid ${emailBrand.colors.border}`,
    borderRadius: emailBrand.radius,
    padding: "28px",
  },
  eyebrow: {
    color: emailBrand.colors.mutedForeground,
    fontSize: "12px",
    fontWeight: "700",
    letterSpacing: "0",
    lineHeight: "18px",
    margin: "0 0 10px",
    textTransform: "uppercase" as const,
  },
  heading: {
    color: emailBrand.colors.foreground,
    fontSize: "24px",
    fontWeight: "700",
    lineHeight: "32px",
    margin: "0 0 18px",
  },
  text: {
    color: emailBrand.colors.foreground,
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 16px",
  },
  mutedText: {
    color: emailBrand.colors.mutedForeground,
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0 0 16px",
  },
  button: {
    backgroundColor: emailBrand.colors.primary,
    borderRadius: "6px",
    color: emailBrand.colors.primaryForeground,
    display: "inline-block",
    fontSize: "14px",
    fontWeight: "600",
    lineHeight: "20px",
    margin: "8px 0 20px",
    padding: "12px 16px",
    textDecoration: "none",
  },
  divider: {
    borderColor: emailBrand.colors.border,
    margin: "24px 0",
  },
  callout: {
    backgroundColor: emailBrand.colors.muted,
    border: `1px solid ${emailBrand.colors.border}`,
    borderRadius: emailBrand.radius,
    margin: "8px 0 20px",
    padding: "14px 16px",
  },
  footer: {
    padding: "18px 4px 0",
  },
  footerText: {
    color: emailBrand.colors.mutedForeground,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "0 0 8px",
  },
  footerLink: {
    color: emailBrand.colors.foreground,
    textDecoration: "underline",
  },
} as const;
