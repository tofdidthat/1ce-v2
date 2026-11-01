import React from 'react';
import { Link } from 'react-router-dom';
function LegalLayout({title,updated,children}:{title:string;updated:string;children:React.ReactNode}){return <div className="legal-site"><header className="legal-header"><Link to="/" className="brand">1CE</Link><Link to="/">Back to 1CE</Link></header><main className="legal-body"><h1>{title}</h1><p className="legal-date">Last updated: {updated}</p><article>{children}</article></main><footer className="legal-footer"><Link to="/terms">Terms of Service</Link><Link to="/privacy">Privacy Policy</Link><p>© 2026 1CE. All rights reserved.</p></footer></div>}
function LegalSection({id,title,children}:{id:string;title:string;children:React.ReactNode}){return <section id={id}><h2>{title}</h2>{children}</section>}
export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="September 1, 2026">
      <LegalSection id="acceptance" title="1. Acceptance of Terms">
        <p>
          By accessing or using 1ce, you agree to these Terms of Service. If you do not agree
          to these terms, you must not use the service.
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. Description of the Service">
        <p>
          1ce is a content creation and publishing tool that can generate short-form videos
          from media supplied by the user and, when authorized, publish that content to connected
          third-party platforms such as YouTube, TikTok, and Instagram.
        </p>
      </LegalSection>

      <LegalSection id="accounts" title="3. Connected Accounts">
        <p>
          You may choose to connect third-party accounts through their official authorization flows.
          You are responsible for maintaining access to those accounts and for complying with the
          terms, policies, and community guidelines of each connected platform.
        </p>
        <p>
          1ce does not ask you to provide your third-party account password directly. Account
          access is granted through the authorization methods made available by the applicable platform.
        </p>
      </LegalSection>

      <LegalSection id="content" title="4. User Content">
        <p>
          You retain ownership of the images, audio, video, text, titles, descriptions, and other
          material that you provide to 1ce.
        </p>
        <p>
          You are responsible for ensuring that you have all rights, licenses, permissions, and
          authorizations required to use and publish your content. You must not use 1ce to
          publish content that infringes intellectual property rights or violates applicable law.
        </p>
      </LegalSection>

      <LegalSection id="publishing" title="5. Publishing to Third-Party Platforms">
        <p>
          When you request publication, 1ce may transmit your content and related metadata to
          the third-party platforms that you have connected. Publication remains subject to each
          platform's technical requirements, review processes, account restrictions, and policies.
        </p>
        <p>
          1ce does not guarantee that a third-party platform will accept, process, display,
          monetize, or keep any submitted content available.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="6. Acceptable Use">
        <p>
          You may not use 1ce to distribute unlawful, fraudulent, abusive, deceptive, or
          infringing material, to interfere with the service, to attempt unauthorized access, or to
          misuse third-party APIs or platform features.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="7. Availability">
        <p>
          1ce may be changed, suspended, interrupted, or discontinued at any time. Features
          that depend on external services may become unavailable because of API changes, outages,
          account restrictions, platform review requirements, or other circumstances outside our control.
        </p>
        <p>
          We do not guarantee uninterrupted, error-free, or permanent availability of the service or
          of any integration with a third-party platform.
        </p>
      </LegalSection>

      <LegalSection id="intellectual-property" title="8. 1ce Intellectual Property">
        <p>
          The 1ce name, interface, software, design, and other service materials, excluding
          user-provided content and third-party materials, are protected by applicable intellectual
          property laws.
        </p>
      </LegalSection>

      <LegalSection id="disclaimer" title="9. Disclaimer">
        <p>
          1ce is provided on an “as is” and “as available” basis to the extent permitted by law.
          We make no warranty that the service will meet every requirement or that third-party
          integrations will always operate without interruption.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="10. Limitation of Liability">
        <p>
          To the maximum extent permitted by applicable law, 1ce will not be liable for indirect,
          incidental, special, consequential, or similar damages arising from use of the service,
          third-party platform actions, loss of access, failed publications, or loss of content.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="11. Termination">
        <p>
          You may stop using 1ce at any time and may revoke platform access through the relevant
          third-party account settings. Access to the service may also be restricted when necessary to
          protect the service, comply with law, or address misuse.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="12. Changes to These Terms">
        <p>
          These Terms may be updated as the service evolves. The current version will be published on
          this page with an updated revision date.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact">
        <p>
          Questions about these Terms may be submitted through the contact information made available
          through 1ce.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}

function MetaDeletionStatus() {
  const [status, setStatus] =
    useState(null)

  const code =
    new URLSearchParams(
      window.location.search
    ).get('deletion')

  useEffect(() => {
    if (!code || !/^[a-f0-9]{32}$/i.test(code)) {
      return
    }

    let cancelled = false

    fetch(
      `${BACKEND_PUBLIC_URL}/internal/meta/data-deletion/${encodeURIComponent(code)}`,
      { cache: 'no-store' }
    )
      .then(async response => ({
        ok: response.ok,
        data:
          await response.json().catch(() => ({}))
      }))
      .then(({ ok, data }) => {
        if (cancelled) return

        setStatus(
          ok
            ? data?.status || 'unknown'
            : 'not_found'
        )
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [code])

  if (!code) return null

  return (
    <LegalSection
      id="data-deletion-status"
      title="Data deletion request status"
    >
      <p>
        Confirmation code:{' '}
        <code>{code}</code>
      </p>

      <p>
        Status:{' '}
        {status === null
          ? 'Checking…'
          : status === 'completed'
            ? 'Completed'
            : status === 'not_found'
              ? 'Request not found'
              : status === 'error'
                ? 'Unable to check status'
                : status}
      </p>
    </LegalSection>
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="September 1, 2026">
      <LegalSection id="overview" title="1. Overview">
        <p>
          This Privacy Policy explains how 1ce handles information when you use the service,
          including when you connect supported third-party accounts and request content publication.
        </p>
      </LegalSection>

      <LegalSection id="information" title="2. Information We Process">
        <p>
          1ce may process information you provide directly, such as uploaded images, audio,
          titles, descriptions, hashtags, and generated video files.
        </p>
        <p>
          When you connect a third-party platform, 1ce may also process authorization tokens,
          account identifiers, granted permissions, and technical information required to perform
          the actions that you request.
        </p>
      </LegalSection>

      <LegalSection id="use" title="3. How Information Is Used">
        <p>
          Information is used to generate videos, maintain authorized connections, publish content
          to accounts you choose to connect, provide requested features, secure the service, diagnose
          errors, and comply with applicable obligations.
        </p>
      </LegalSection>

      <LegalSection id="third-parties" title="4. Third-Party Platforms">
        <p>
          If you connect YouTube, TikTok, Instagram, or another supported service, information may be
          transmitted to that platform in order to complete the action you requested. Those platforms
          process information under their own privacy policies and terms.
        </p>
      </LegalSection>

      <LegalSection id="tokens" title="5. Account Authorization and Tokens">
        <p>
          1ce uses official authorization flows where available. Authorization credentials are
          intended to be handled securely and are used only to perform permitted actions for connected
          accounts. You may revoke access through the relevant third-party platform.
        </p>
      </LegalSection>

      <LegalSection id="storage" title="6. Storage and Retention">
        <p>
          1ce is designed to minimize persistent storage of uploaded and generated media.
          Information may be retained only for as long as reasonably necessary to provide the service,
          maintain authorized connections, secure the application, or satisfy legal requirements.
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="7. Sharing of Information">
        <p>
          1ce does not sell personal information. Information may be shared with service
          providers and connected platforms only as necessary to operate the service, complete actions
          requested by you, maintain security, or comply with law.
        </p>
      </LegalSection>

      <LegalSection id="security" title="8. Security">
        <p>
          Reasonable technical and organizational safeguards are used to protect information. However,
          no internet-based service or storage method can be guaranteed to be completely secure.
        </p>
      </LegalSection>

      <LegalSection id="choices" title="9. Your Choices">
        <p>
          You may choose not to connect a third-party account, may disconnect or revoke access through
          the relevant platform, and may stop using 1ce at any time.
        </p>
      </LegalSection>

      <LegalSection id="children" title="10. Children">
        <p>
          1ce is not directed to children who are below the minimum age required to use the
          applicable service under local law.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes to This Policy">
        <p>
          This Privacy Policy may be updated as 1ce changes. The current version will be posted
          on this page together with its revision date.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="12. Contact">
        <p>
          Questions about privacy or data handling may be submitted through the contact information
          made available through 1ce.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}


