import { t } from '@extension/i18n';

interface DataDisclosureProps {
  isDarkMode: boolean;
  onAccept: () => void;
}

const POLICY_URL = 'https://github.com/derpx06/webgenie/blob/main/PRIVACY.md';

/**
 * Shown once, before the first task, and the agent will not start until it has been accepted.
 *
 * It is a screen of its own rather than a line in the options page or a link to a policy because the store requires
 * the disclosure to be in the product and to come before collection: "must not be located only in a privacy policy".
 * It says what is sent and to whom, and what the agent will not do, in the order a person deciding would ask.
 */
const DataDisclosure = ({ onAccept }: DataDisclosureProps) => (
  <div className="wg-scroll">
    <div className="mx-auto flex max-w-md flex-col gap-5 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t('disclosure_title')}</h1>
        <p className="wg-meta">{t('disclosure_lead')}</p>
      </header>

      <section className="wg-card flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">{t('disclosure_sendsTitle')}</h2>
        <p className="text-sm leading-relaxed">{t('disclosure_sends')}</p>
        <p className="text-sm leading-relaxed">{t('disclosure_nothing')}</p>
      </section>

      <section className="wg-card flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">{t('disclosure_doesTitle')}</h2>
        <p className="text-sm leading-relaxed">{t('disclosure_does')}</p>
      </section>

      <div className="flex flex-col items-start gap-3">
        <button type="button" className="wg-btn wg-btn-primary" onClick={onAccept}>
          {t('disclosure_accept')}
        </button>
        <a className="wg-meta underline" href={POLICY_URL} target="_blank" rel="noreferrer">
          {t('disclosure_policy')}
        </a>
      </div>
    </div>
  </div>
);

export default DataDisclosure;
