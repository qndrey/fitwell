import { useEffect, useState } from 'preact/hooks';
import { Card, LinkButton, Screen } from '../../ui';
import { loadBundledFoods, type DatasetInfo } from '@fitwell/core/data/bundledFoods';
import { loadExercises } from '@fitwell/core/data/exercises';
import licenses from '../../about/generated/licenses.json';
import { OTHER_CREDITS, type Credit } from '../../about/attributions';
import { t } from '../../i18n';

function Licence({ title, children }: { title: string; children: string }) {
  return (
    <details class="howto">
      <summary>{title}</summary>
      <pre class="licence">{children}</pre>
    </details>
  );
}

function CreditCard({ credit }: { credit: Credit }) {
  return (
    <Card labelledBy={`credit-${credit.id}`}>
      <div class="stack gap-2">
        <h3 id={`credit-${credit.id}`}>{credit.name}</h3>
        <p class="t-caption">{credit.use}</p>
        <p>{credit.text}</p>
        <p class="t-caption">
          {credit.licenseUrl ? <a href={credit.licenseUrl} rel="noreferrer noopener">{credit.license}</a> : credit.license}
          {credit.url && <> · <a href={credit.url} rel="noreferrer noopener">{credit.url.replace(/^https?:\/\//, '')}</a></>}
        </p>
      </div>
    </Card>
  );
}

/** Privacy in plain words, where the data comes from, and what the app is built with (with licence texts). */
export function About() {
  const [foods, setFoods] = useState<DatasetInfo | null>(null);
  const [ex, setEx] = useState<{ name: string; url: string; license: string; commit: string } | null>(null);
  useEffect(() => {
    void loadBundledFoods().then((d) => setFoods(d.info));
    void loadExercises().then((d) => setEx(d.meta));
  }, []);

  return (
    <Screen title={t('about.title')} subtitle={`${t('app.name')} ${__APP_VERSION__}`}>
      <LinkButton onClick={() => (location.hash = '#/settings')}>{t('about.back')}</LinkButton>

      <Card labelledBy="privacy-h">
        <div class="stack gap-2">
          <h2 id="privacy-h">{t('about.privacy.title')}</h2>
          <p>{t('about.privacy.1')}</p>
          <p>{t('about.privacy.2')}</p>
          <p>{t('about.privacy.ai')}</p>
          <p>{t('about.privacy.3')}</p>
        </div>
      </Card>

      <section class="stack gap-3" aria-labelledby="data-h">
        <h2 id="data-h">{t('about.data')}</h2>
        {foods && (
          <Card labelledBy="credit-frida">
            <div class="stack gap-2">
              <h3 id="credit-frida">{foods.name}</h3>
              <p class="t-caption">{t('about.frida.use')}</p>
              <p>{foods.attribution}</p>
              <p class="t-caption">
                <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer noopener">{foods.license}</a> · {t('about.frida.note')}
              </p>
            </div>
          </Card>
        )}
        {ex && (
          <Card labelledBy="credit-ex">
            <div class="stack gap-2">
              <h3 id="credit-ex">{ex.name}</h3>
              <p class="t-caption">{t('about.ex.use')}</p>
              <p>{t('about.ex.text')}</p>
              <p class="t-caption">{ex.license} · <a href={ex.url} rel="noreferrer noopener">github.com/yuhonas/free-exercise-db</a> · {ex.commit.slice(0, 7)}</p>
            </div>
          </Card>
        )}
        {OTHER_CREDITS.map((c) => <CreditCard key={c.id} credit={c} />)}
      </section>

      <section class="stack gap-3" aria-labelledby="sw-h">
        <h2 id="sw-h">{t('about.software')}</h2>
        <p class="t-caption">{t('about.software.help')}</p>
        <Card>
          <ul class="stack gap-3">
            {licenses.packages.map((p) => (
              <li key={p.name}>
                <p><strong>{p.name}</strong> {p.version} · {p.license}{p.url && <> · <a href={p.url} rel="noreferrer noopener">{p.url.replace(/^https?:\/\/(www\.)?/, '')}</a></>}</p>
                <Licence title={t('about.licenceText')}>{p.text}</Licence>
              </li>
            ))}
            <li>
              <p><strong>ZXing-C++</strong> · Apache License 2.0</p>
              <Licence title={t('about.licenceText')}>{licenses.apache2}</Licence>
            </li>
          </ul>
        </Card>
      </section>
    </Screen>
  );
}
