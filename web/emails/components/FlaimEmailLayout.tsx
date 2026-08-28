import * as React from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";
import { emailBrand } from "../brand";

interface FlaimEmailLayoutProps {
  children: React.ReactNode;
  eyebrow?: string;
  footerDisclosure?: React.ReactNode;
  footerDescription?: React.ReactNode;
  footerSupport?: React.ReactNode;
  headerUrl?: string;
  lang?: string;
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
  footerDisclosure,
  footerDescription,
  footerSupport,
  headerUrl = emailBrand.url,
  lang = "en",
  preview,
  title,
}: FlaimEmailLayoutProps) {
  const supportLine = footerSupport ?? (
    <>
      Need help? Email{" "}
      <Link href={`mailto:${emailBrand.supportEmail}`} style={styles.footerLink}>
        {emailBrand.supportEmail}
      </Link>
      .
    </>
  );

  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Section
              style={eyebrow ? styles.cardHeader : styles.cardTitleHeader}
            >
              <Row>
                <Column style={styles.cardHeaderText}>
                  {eyebrow ? (
                    <Text style={styles.cardEyebrow}>{eyebrow}</Text>
                  ) : (
                    <Heading as="h1" style={styles.cardHeaderHeading}>
                      {title}
                    </Heading>
                  )}
                </Column>
                <Column
                  align="right"
                  data-skip-in-text="true"
                  style={styles.cardLogoColumn}
                >
                  <Link href={headerUrl} style={styles.logoLink}>
                    <Img
                      alt=""
                      height="36"
                      src={emailBrand.logoUrl}
                      style={styles.cardLogo}
                      width="36"
                    />
                  </Link>
                </Column>
              </Row>
            </Section>
            {eyebrow ? (
              <Heading as="h1" style={styles.heading}>
                {title}
              </Heading>
            ) : null}
            {children}
          </Section>

          <Section style={styles.footer}>
            {footerDescription ? (
              <Text style={styles.footerText}>{footerDescription}</Text>
            ) : null}
            {footerDisclosure ? (
              <Text style={styles.footerText}>{footerDisclosure}</Text>
            ) : null}
            <Text style={styles.footerText}>{supportLine}</Text>
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

export function FlaimCalloutText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.calloutText}>{children}</Text>;
}

export function FlaimFooterLink({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link href={href} style={styles.footerLink}>
      {children}
    </Link>
  );
}

export function FlaimDivider() {
  return <Hr style={styles.divider} />;
}

export function FlaimCallout({ children }: { children: React.ReactNode }) {
  return <Section style={styles.callout}>{children}</Section>;
}

const styles = {
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
  logoLink: {
    textDecoration: "none",
  },
  card: {
    backgroundColor: emailBrand.colors.card,
    borderColor: emailBrand.colors.border,
    borderRadius: emailBrand.radius.card,
    borderStyle: "solid",
    borderWidth: "1px",
    padding: "28px",
  },
  cardHeader: {
    margin: "0 0 10px",
    width: "100%",
  },
  cardTitleHeader: {
    margin: "0 0 18px",
    width: "100%",
  },
  cardHeaderText: {
    verticalAlign: "middle",
  },
  cardHeaderHeading: {
    color: emailBrand.colors.foreground,
    fontSize: "24px",
    fontWeight: "700",
    lineHeight: "32px",
    margin: "0",
  },
  cardEyebrow: {
    color: emailBrand.colors.mutedForeground,
    fontSize: "12px",
    fontWeight: "700",
    lineHeight: "18px",
    margin: "0",
  },
  cardLogoColumn: {
    verticalAlign: "middle",
    width: "36px",
  },
  cardLogo: {
    display: "block",
    margin: "0 0 0 auto",
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
    borderRadius: emailBrand.radius.button,
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
    borderColor: emailBrand.colors.border,
    borderRadius: emailBrand.radius.card,
    borderStyle: "solid",
    borderWidth: "1px",
    margin: "8px 0 20px",
    padding: "14px 16px",
  },
  calloutText: {
    color: emailBrand.colors.mutedForeground,
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0",
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
