import { ArrowLeft, Mic } from 'lucide-react';
import { useEffect, useState } from 'react';
import { engine } from '../audio/engine';
import { useEngine, useLatency } from '../audio/hooks';
import { outputSelectionSupported } from '../audio/devices';
import { LevelMeter } from '../components/Waveform';
import { Button, IconButton, Notice } from '../components/ui';
import { useT, type MessageKey } from '../i18n';
import { loadQuranText, SURAH_SOURCE } from '../lib/quran';
import { back } from '../lib/router';

type Block = { h?: string; p?: string; li?: string[] };

const CONTENT: Record<'privacy' | 'help' | 'troubleshooting', { en: { title: string; blocks: Block[] }; ar: { title: string; blocks: Block[] } }> = {
  privacy: {
    en: {
      title: 'Privacy policy',
      blocks: [
        { p: 'Qari Studio is designed so that your recitation stays yours.' },
        { h: 'What is stored' },
        { li: ['Your recordings (original audio) and their names, dates, surah and preset settings.', 'Your preferences: theme, language, greeting name, audio devices and custom presets.'] },
        { p: 'Everything is stored locally in this browser on this device. Nothing is sent to any server.' },
        { h: 'What is not collected' },
        { li: ['No account, no sign-in.', 'No analytics, tracking pixels, advertising or third-party SDKs.', 'No uploads of audio, ever — unless you export a file and share it yourself.'] },
        { h: 'Microphone' },
        { p: 'The microphone is used only while you are in the Studio or have Live Listen on. It is released when you leave the Studio. You can revoke access in your browser’s site settings at any time.' },
        { h: 'Deleting your data' },
        { p: 'Delete individual recordings from My Recordings, or everything at once in Settings → Privacy. Clearing this site’s data in your browser also removes everything.' },
      ],
    },
    ar: {
      title: 'سياسة الخصوصية',
      blocks: [
        { p: 'صُمّم استوديو القارئ لتبقى تلاوتك ملكًا لك.' },
        { h: 'ما الذي يُحفظ' },
        { li: ['تسجيلاتك (الصوت الأصلي) وأسماؤها وتواريخها والسورة وإعدادات الصوت.', 'تفضيلاتك: السمة واللغة واسم التحية وأجهزة الصوت والإعدادات المخصصة.'] },
        { p: 'يُحفظ كل شيء محليًا في هذا المتصفح على هذا الجهاز، ولا يُرسل شيء إلى أي خادم.' },
        { h: 'ما الذي لا يُجمع' },
        { li: ['لا حساب ولا تسجيل دخول.', 'لا تحليلات ولا تتبّع ولا إعلانات ولا أدوات من أطراف ثالثة.', 'لا يُرفع أي صوت أبدًا — إلا إذا صدّرت ملفًا وشاركته بنفسك.'] },
        { h: 'الميكروفون' },
        { p: 'يُستخدم الميكروفون فقط وأنت في الاستوديو أو أثناء تشغيل الاستماع المباشر، ويُحرّر عند مغادرة الاستوديو. يمكنك سحب الإذن من إعدادات الموقع في متصفحك في أي وقت.' },
        { h: 'حذف بياناتك' },
        { p: 'احذف التسجيلات واحدًا واحدًا من «تسجيلاتي»، أو كلها دفعة واحدة من الإعدادات ← الخصوصية. كما أن مسح بيانات هذا الموقع من المتصفح يحذف كل شيء.' },
      ],
    },
  },
  help: {
    en: {
      title: 'Help',
      blocks: [
        { h: 'Recording a recitation' },
        { li: ['Tap Start Reciting and choose a surah (or Free recitation). You can pick a range of ayahs.', 'In the Studio, turn on the microphone, choose a vocal preset and press the record button.', 'Pause and resume as often as you like. Press Stop and review when you finish.', 'On the review screen, listen, compare Original and Enhanced, try other presets and save.'] },
        { h: 'Live Listen' },
        { p: 'Wear headphones, then turn on Live Listen to hear your enhanced voice in real time. Wired or USB-C headphones give the lowest delay; Bluetooth adds a delay the app cannot remove.' },
        { h: 'Original and enhanced' },
        { p: 'Your original voice is always kept. Presets are applied without changing it, so you can switch presets later and export either version.' },
        { h: 'Exporting and backing up' },
        { p: 'Export any recording as WAV, M4A (where the browser supports AAC) or MP3. To keep everything safe, use Settings → Storage → Back up all recordings.' },
        { h: 'Ayahs and accuracy' },
        { p: 'The ayah range you choose is saved with the recording. Qari Studio does not listen for or identify ayahs automatically, and it does not check tajweed or pronunciation.' },
      ],
    },
    ar: {
      title: 'المساعدة',
      blocks: [
        { h: 'تسجيل تلاوة' },
        { li: ['اضغط «ابدأ التلاوة» واختر سورة (أو «تلاوة حرة»)، ويمكنك اختيار نطاق من الآيات.', 'في الاستوديو شغّل الميكروفون واختر إعدادًا صوتيًا ثم اضغط زر التسجيل.', 'أوقف مؤقتًا واستأنف متى شئت، واضغط «إنهاء ومراجعة» عند الانتهاء.', 'في شاشة المراجعة استمع، وقارن بين الأصلي والمحسّن، وجرّب إعدادات أخرى ثم احفظ.'] },
        { h: 'الاستماع المباشر' },
        { p: 'ضع السماعات ثم شغّل الاستماع المباشر لتسمع صوتك المحسّن فورًا. السماعات السلكية أو USB-C تعطي أقل تأخير، أما البلوتوث فيضيف تأخيرًا لا يستطيع التطبيق إزالته.' },
        { h: 'الأصلي والمحسّن' },
        { p: 'صوتك الأصلي محفوظ دائمًا، وتُطبّق الإعدادات دون تغييره، فيمكنك تبديلها لاحقًا وتصدير أي النسختين.' },
        { h: 'التصدير والنسخ الاحتياطي' },
        { p: 'صدّر أي تسجيل بصيغة WAV أو M4A (إن كان المتصفح يدعم AAC) أو MP3. وللحفاظ على كل شيء استخدم الإعدادات ← التخزين ← نسخ احتياطي لكل التسجيلات.' },
        { h: 'الآيات والدقة' },
        { p: 'يُحفظ نطاق الآيات الذي تختاره مع التسجيل. لا يتعرّف استوديو القارئ على الآيات تلقائيًا، ولا يتحقق من التجويد أو النطق.' },
      ],
    },
  },
  troubleshooting: {
    en: {
      title: 'Audio troubleshooting',
      blocks: [
        { h: 'No sound from the microphone' },
        { li: ['Check that the browser has permission to use the microphone (the lock icon next to the address).', 'Close other apps that may be using the microphone (calls, recorders).', 'Choose a different microphone under Live Listen or Settings → Audio.'] },
        { h: 'Live Listen sounds delayed' },
        { li: ['Use wired or USB-C headphones instead of Bluetooth.', 'Set Settings → Audio → Monitoring latency to Lowest (use Stable if you hear crackles).', 'Desktop Chrome or Edge usually achieves the lowest delay in a browser. Phones and Bluetooth add more.'] },
        { h: 'Howling or whistling' },
        { p: 'That is acoustic feedback: the speakers are feeding the microphone. Use headphones. Qari Studio mutes Live Listen automatically when it detects sustained overload.' },
        { h: 'Bluetooth headset sounds like a phone call' },
        { p: 'When a Bluetooth headset’s microphone is in use, many systems switch to hands-free mode, which lowers quality for both directions. Record with the built-in microphone while listening on the headset, or use wired headphones.' },
        { h: 'Crackles or dropouts' },
        { p: 'Choose Stable monitoring latency, close heavy tabs, and keep the device plugged in. Your recording is captured separately from Live Listen and saved every two seconds.' },
      ],
    },
    ar: {
      title: 'حل مشكلات الصوت',
      blocks: [
        { h: 'لا يصل صوت من الميكروفون' },
        { li: ['تأكد أن للمتصفح إذن استخدام الميكروفون (رمز القفل بجوار العنوان).', 'أغلق التطبيقات الأخرى التي قد تستخدم الميكروفون (المكالمات، المسجّلات).', 'اختر ميكروفونًا آخر من الاستماع المباشر أو الإعدادات ← الصوت.'] },
        { h: 'الاستماع المباشر متأخر' },
        { li: ['استخدم سماعات سلكية أو USB-C بدل البلوتوث.', 'اضبط الإعدادات ← الصوت ← تأخير الاستماع على «الأدنى» (واختر «ثابت» إن سمعت تقطّعًا).', 'يحقق Chrome أو Edge على الحاسوب عادةً أقل تأخير في المتصفح، وتضيف الهواتف والبلوتوث تأخيرًا أكبر.'] },
        { h: 'صفير أو عواء' },
        { p: 'هذه تغذية راجعة صوتية: المكبرات تعيد الصوت إلى الميكروفون. استخدم السماعات. يكتم استوديو القارئ الاستماع المباشر تلقائيًا عند اكتشاف تحميل زائد مستمر.' },
        { h: 'سماعة البلوتوث تبدو كمكالمة هاتفية' },
        { p: 'عند استخدام ميكروفون سماعة البلوتوث، تنتقل أنظمة كثيرة إلى وضع المكالمات فتنخفض الجودة في الاتجاهين. سجّل بالميكروفون المدمج مع الاستماع عبر السماعة، أو استخدم سماعات سلكية.' },
        { h: 'تقطّع أو انقطاعات' },
        { p: 'اختر تأخير الاستماع «ثابت»، وأغلق التبويبات الثقيلة، وأبقِ الجهاز موصولًا بالشاحن. يُلتقط تسجيلك منفصلًا عن الاستماع المباشر ويُحفظ كل ثانيتين.' },
      ],
    },
  },
};

function Diagnostics() {
  const t = useT();
  const st = useEngine();
  const latency = useLatency(st.input.status === 'on');
  const analyser = st.input.status === 'on' ? engine.getInputAnalyser() : null;
  useEffect(
    () => () => {
      if (engine.getState().recording.state === 'idle') engine.closeInput();
    },
    [],
  );
  const yes = t('diag.supported');
  const no = t('diag.notSupported');
  return (
    <div className="card card-pad diag">
      <h2 className="section-title">{t('diag.title')}</h2>
      <dl className="diag-list">
        <div>
          <dt>{t('diag.monitoring')}</dt>
          <dd>{typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia ? yes : no}</dd>
        </div>
        <div>
          <dt>{t('diag.outputSelect')}</dt>
          <dd>{outputSelectionSupported() ? yes : no}</dd>
        </div>
        <div>
          <dt>{t('diag.context')}</dt>
          <dd>{t(`diag.state.${st.contextState}` as MessageKey)}</dd>
        </div>
        <div>
          <dt>{t('diag.sampleRate')}</dt>
          <dd className="num">{st.sampleRate ? `${t.n(st.sampleRate)} Hz` : '—'}</dd>
        </div>
        <div>
          <dt>{t('privacy.mic')}</dt>
          <dd>{t(`permission.${st.permission}` as MessageKey)}</dd>
        </div>
        <div>
          <dt>{t('live.latency')}</dt>
          <dd className="num">{latency ? `${t.n(Math.round(latency.total * 1000))} ms` : '—'}</dd>
        </div>
      </dl>
      {st.input.status === 'error' && <Notice kind="error">{t(`err.${st.input.error ?? 'unknown'}` as MessageKey)}</Notice>}
      {st.input.status === 'on' ? (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <span className="faint">
            {t('diag.micLevel')} — {st.input.label}
          </span>
          <LevelMeter analyser={analyser} />
        </div>
      ) : (
        <Button variant="secondary" icon={<Mic />} onClick={() => void engine.openInput()} style={{ marginTop: 12 }}>
          {t('diag.start')}
        </Button>
      )}
    </div>
  );
}

function Licenses() {
  const t = useT();
  const [info, setInfo] = useState<{ copyright: string; edition: string; sha256: string } | null>(null);
  useEffect(() => {
    void loadQuranText().then((q) => setInfo({ copyright: q.copyright, edition: q.edition, sha256: q.sha256 }));
  }, []);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card card-pad prose">
        <h2>{t.lang === 'ar' ? 'نص القرآن الكريم' : 'Quran text'}</h2>
        <p>
          {info?.edition ?? 'Tanzil Quran Text'} —{' '}
          <a href="https://tanzil.net" target="_blank" rel="noreferrer">
            tanzil.net
          </a>
        </p>
        <p className="faint">
          {t.lang === 'ar'
            ? 'النص منسوخ حرفيًا دون أي تعديل، ويُعرض كما هو.'
            : 'The text is reproduced verbatim, without any modification, and displayed as published.'}
        </p>
        {info && (
          <>
            <pre className="license-block" dir="ltr">
              {info.copyright}
            </pre>
            <p className="faint" dir="ltr" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>
              SHA-256: {info.sha256}
            </p>
          </>
        )}
      </div>
      <div className="card card-pad prose">
        <h2>{t.lang === 'ar' ? 'بيانات السور' : 'Surah information'}</h2>
        <ul dir="ltr">
          <li>{SURAH_SOURCE.metadata}</li>
          <li>{SURAH_SOURCE.transliteration}</li>
        </ul>
      </div>
      <div className="card card-pad prose">
        <h2>{t.lang === 'ar' ? 'الخطوط والمكتبات' : 'Fonts & libraries'}</h2>
        <ul dir="ltr">
          <li>Amiri &amp; Amiri Quran — Khaled Hosny, SIL Open Font License 1.1</li>
          <li>IBM Plex Sans Arabic — IBM, SIL Open Font License 1.1</li>
          <li>Inter — Rasmus Andersson, SIL Open Font License 1.1</li>
          <li>Cormorant Garamond — Christian Thalmann, SIL Open Font License 1.1</li>
          <li>React, Zustand, idb, fflate, mp4-muxer, lamejs (LGPL), Lucide icons (ISC)</li>
        </ul>
      </div>
    </div>
  );
}

export function InfoScreen({ page }: { page: string }) {
  const t = useT();
  const key = page as keyof typeof CONTENT;
  const content = CONTENT[key]?.[t.lang];
  const title =
    page === 'licenses' ? t('about.sources') : content?.title ?? t('settings.title');
  return (
    <div className="page narrow info">
      <div className="topbar">
        <IconButton className="back" label={t('common.back')} onClick={() => back('/settings')}>
          <ArrowLeft />
        </IconButton>
        <h1 className="topbar-title">{title}</h1>
      </div>
      {page === 'troubleshooting' && <Diagnostics />}
      {content && (
        <div className="card card-pad prose" style={{ marginTop: page === 'troubleshooting' ? 16 : 0 }}>
          {content.blocks.map((b, i) =>
            b.h ? (
              <h2 key={i}>{b.h}</h2>
            ) : b.li ? (
              <ul key={i}>
                {b.li.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>{b.p}</p>
            ),
          )}
        </div>
      )}
      {page === 'licenses' && <Licenses />}
    </div>
  );
}
