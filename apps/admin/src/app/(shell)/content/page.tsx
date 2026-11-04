'use client';
import { Suspense, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, Button, EmptyState, Field, IconButton, Select, Switch, Tabs, Textarea, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, Gate, post, RowMenu, Section, Table, type ActionSpec } from '@/components/kit';
import { LABELS } from '@/components/badges';
import { api } from '@/lib/api';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt } from '@/lib/fmt';

interface Faq { id: string; question: string; answer_md: string | null; placements: string[]; sort_order: number; is_published: boolean }
interface Topic { id: string; slug: string; title: string; description: string; contact_topic: string | null; sort_order: number; is_published: boolean; article_count: number }
interface Article { id: string; topic_id: string; topic_title: string; slug: string; title: string; summary: string | null; body_md: string; is_popular: boolean; popular_label: string | null; published_at: string | null }
interface LegalV { id: string; version: string; title: string; body_md: string; effective_at: string; is_current: boolean; published_by: string | null }

function Md({ text }: { text: string }) {
  return (
    <div className="prose-sm max-w-none space-y-2 text-body-sm text-fg [&_a]:text-fg-brand [&_h2]:text-h5 [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{text || '_Nothing to preview._'}</ReactMarkdown>
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);

/** SCR-ADM-16 Content (Doc 09 §6, §16.2–16.3). */
function Content() {
  usePageHeader('Content', 'FAQ, help articles and legal pages.');
  const { tick } = useSession();
  const u = useUrlState();
  const tab = u.get('tab', 'faqs');
  const faqs = useApi<Faq[]>(tab === 'faqs' ? '/admin/content/faqs' : null, { t: tick });
  const topics = useApi<Topic[]>(tab === 'help' ? '/admin/content/help/topics' : null, { t: tick });
  const articles = useApi<Article[]>(tab === 'help' ? '/admin/content/help/articles' : null, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const articleId = u.get('article');
  const faqSpec = (f: Faq | null): ActionSpec => ({
    title: f ? 'Edit FAQ' : 'Add FAQ',
    confirm: 'Save FAQ',
    width: 560,
    fields: [
      { name: 'question', type: 'text', label: 'Question', required: true, max: 200, default: f?.question ?? '' },
      { name: 'answer_md', type: 'textarea', label: 'Answer (Markdown)', max: 5000, default: f?.answer_md ?? '', helper: 'Required to publish.' },
      { name: 'placements', type: 'checkboxes', label: 'Placements', required: true, default: f?.placements ?? ['help'], options: [{ value: 'home', label: 'Home' }, { value: 'help', label: 'Help center' }] },
      { name: 'sort_order', type: 'text', label: 'Order', default: String(f?.sort_order ?? '') },
      { name: 'is_published', type: 'switch', label: 'Published', default: f?.is_published ?? false },
    ],
    extra: (v) => (v.answer_md ? <div className="rounded-[12px] border border-line-subtle p-3"><p className="mb-1 text-label-sm text-fg-tertiary">Preview</p><Md text={String(v.answer_md)} /></div> : null),
    submit: (v) => api(f ? `/admin/content/faqs/${f.id}` : '/admin/content/faqs', { method: f ? 'PATCH' : 'POST', body: { question: v.question, answer_md: v.answer_md || null, placements: v.placements, sort_order: v.sort_order ? Number(v.sort_order) : undefined, is_published: v.is_published } }).then((r) => r.data),
    success: (d) => ((d as { revalidated?: boolean }).revalidated === false ? 'Saved. The site may take a few minutes to update.' : 'FAQ saved.'),
    onDone: faqs.reload,
  });
  const move = async (f: Faq, dir: -1 | 1) => {
    try {
      await api(`/admin/content/faqs/${f.id}`, { method: 'PATCH', body: { sort_order: Math.max(0, f.sort_order + dir) } });
      faqs.reload();
    } catch (e) {
      reportError(e);
    }
  };
  const togglePub = async (f: Faq, on: boolean) => {
    try {
      await api(`/admin/content/faqs/${f.id}`, { method: 'PATCH', body: { is_published: on } });
      toast.success(on ? 'FAQ published.' : 'FAQ hidden.');
      faqs.reload();
    } catch (e) {
      reportError(e);
    }
  };
  const topicSpec = (t: Topic | null): ActionSpec => ({
    title: t ? 'Edit topic' : 'New topic',
    confirm: 'Save topic',
    fields: [
      { name: 'title', type: 'text', label: 'Title', required: true, max: 60, default: t?.title ?? '' },
      { name: 'slug', type: 'text', label: 'Slug', required: true, max: 60, default: t?.slug ?? '', pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, patternMsg: 'Use lowercase letters, digits and hyphens.' },
      { name: 'description', type: 'text', label: 'Description', required: true, max: 160, default: t?.description ?? '' },
      { name: 'contact_topic', type: 'select', label: 'Contact topic', default: t?.contact_topic ?? '', options: [{ value: '', label: 'None' }, ...Object.entries(LABELS.topic).map(([value, label]) => ({ value, label }))] },
      { name: 'sort_order', type: 'text', label: 'Order', default: String(t?.sort_order ?? 0) },
      { name: 'is_published', type: 'switch', label: 'Published', default: t?.is_published ?? false },
    ],
    submit: (v) => api(t ? `/admin/content/help/topics/${t.id}` : '/admin/content/help/topics', { method: t ? 'PATCH' : 'POST', body: { ...v, contact_topic: v.contact_topic || null, sort_order: Number(v.sort_order || 0) } }).then((r) => r.data),
    success: 'Topic saved.',
    onDone: topics.reload,
  });
  if (tab === 'help' && articleId) return <ArticleEditor id={articleId === 'new' ? null : articleId} topics={topics.data ?? []} article={articles.data?.find((a) => a.id === articleId) ?? null} onBack={() => { u.set({ article: null }); articles.reload(); }} />;
  return (
    <Gate perms={['content.write']}>
      <Tabs label="Content" value={tab} panelId="cms" className="mb-4" onChange={(v) => u.set({ tab: v === 'faqs' ? null : v, slug: null })} tabs={[{ value: 'faqs', label: 'FAQs' }, { value: 'help', label: 'Help' }, { value: 'legal', label: 'Legal' }]} />
      <div id="cms">
        {tab === 'faqs' ? (
          <>
            <div className="mb-3 hidden justify-end laptop:flex"><Button onClick={() => setSpec(faqSpec(null))}>Add FAQ</Button></div>
            <Table<Faq>
              caption="FAQs"
              rows={faqs.data}
              loading={faqs.loading}
              error={faqs.error}
              rowKey={(f) => f.id}
              empty={<EmptyState title="No FAQs yet" action={<Button onClick={() => setSpec(faqSpec(null))}>Add FAQ</Button>} compact />}
              cols={[
                { key: 'q', header: 'Question', cell: (f) => <span className="text-fg">{f.question}</span> },
                { key: 'p', header: 'Placements', cell: (f) => <span className="flex gap-1">{f.placements.map((p) => <span key={p} className="rounded-[6px] bg-muted px-2 text-label-sm leading-6 text-fg-secondary">{p}</span>)}</span> },
                { key: 'o', header: 'Order', cell: (f) => <span className="flex items-center gap-1">{f.sort_order}<IconButton icon="chevron-up" aria-label="Move up" size="S" variant="ghost" onClick={() => void move(f, -1)} /><IconButton icon="chevron-down" aria-label="Move down" size="S" variant="ghost" onClick={() => void move(f, 1)} /></span> },
                { key: 'pub', header: 'Published', cell: (f) => <Switch label="Published" labelHidden checked={f.is_published} disabled={!f.answer_md} locked={!f.answer_md} lockedReason="Add an answer first" onCheckedChange={(v) => void togglePub(f, v)} /> },
                { key: 'm', header: '', align: 'right', cell: (f) => <RowMenu items={[{ key: 'e', label: 'Edit', onSelect: () => setSpec(faqSpec(f)) }, { key: 'd', label: 'Delete', tone: 'danger', onSelect: () => setSpec({ title: 'Delete this FAQ?', description: "It disappears from the site right away. This can't be undone.", confirm: 'Delete FAQ', variant: 'destructive', submit: () => api(`/admin/content/faqs/${f.id}`, { method: 'DELETE' }), success: 'FAQ deleted.', onDone: faqs.reload }) }]} /> },
              ]}
            />
          </>
        ) : null}
        {tab === 'help' ? (
          <div className="space-y-5">
            <Section title="Topics" actions={<span className="hidden laptop:inline"><Button size="S" onClick={() => setSpec(topicSpec(null))}>New topic</Button></span>}>
              <Table<Topic> caption="Topics" rows={topics.data} loading={topics.loading} rowKey={(t) => t.id} cols={[{ key: 't', header: 'Title', cell: (t) => t.title }, { key: 's', header: 'Slug', cell: (t) => <span className="adm-mono">{t.slug}</span> }, { key: 'c', header: 'Contact topic', cell: (t) => (t.contact_topic ? LABELS.topic[t.contact_topic] : '—') }, { key: 'o', header: 'Order', align: 'right', cell: (t) => t.sort_order }, { key: 'p', header: 'Published', cell: (t) => (t.is_published ? 'Yes' : 'No') }, { key: 'n', header: 'Articles', align: 'right', cell: (t) => t.article_count }, { key: 'm', header: '', align: 'right', cell: (t) => <RowMenu items={[{ key: 'e', label: 'Edit', onSelect: () => setSpec(topicSpec(t)) }]} /> }]} />
            </Section>
            <Section title="Articles" actions={<span className="hidden laptop:inline"><Button size="S" onClick={() => u.set({ article: 'new' })}>New article</Button></span>}>
              <Table<Article> caption="Articles" rows={articles.data} loading={articles.loading} rowKey={(a) => a.id} onRowClick={(a) => u.set({ article: a.id })} empty={<EmptyState title="No articles yet" compact />} cols={[{ key: 't', header: 'Title', cell: (a) => a.title }, { key: 'tp', header: 'Topic', cell: (a) => a.topic_title }, { key: 's', header: 'Slug', cell: (a) => <span className="adm-mono">{a.slug}</span> }, { key: 'p', header: 'Popular', cell: (a) => (a.is_popular ? <span className="rounded-full bg-brand-subtle px-2 text-label-sm text-fg-brand">{a.popular_label ?? 'Popular'}</span> : '—') }, { key: 'pub', header: 'Published', cell: (a) => (a.published_at ? dt(a.published_at) : 'Draft') }, { key: 'm', header: '', align: 'right', cell: (a) => <RowMenu items={[{ key: 'e', label: 'Edit', onSelect: () => u.set({ article: a.id }) }, { key: 'd', label: 'Delete', tone: 'danger', onSelect: () => setSpec({ title: 'Delete this article?', description: "It disappears from the site right away. This can't be undone.", confirm: 'Delete article', variant: 'destructive', submit: () => api(`/admin/content/help/articles/${a.id}`, { method: 'DELETE' }), success: 'Article deleted.', onDone: articles.reload }) }]} /> }]} />
            </Section>
          </div>
        ) : null}
        {tab === 'legal' ? <Legal /> : null}
      </div>
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

function ArticleEditor({ id, topics, article, onBack }: { id: string | null; topics: Topic[]; article: Article | null; onBack: () => void }) {
  const [f, setF] = useState({ topic_id: '', title: '', slug: '', summary: '', body_md: '', is_popular: false, popular_label: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (article) setF({ topic_id: article.topic_id, title: article.title, slug: article.slug, summary: article.summary ?? '', body_md: article.body_md, is_popular: article.is_popular, popular_label: article.popular_label ?? '' });
    setSlugEdited(!!article);
  }, [article]);
  const save = async (publish?: boolean) => {
    setBusy(true);
    setErrs({});
    try {
      await api(id ? `/admin/content/help/articles/${id}` : '/admin/content/help/articles', { method: id ? 'PATCH' : 'POST', body: { ...f, ...(publish === undefined ? {} : { publish }) } });
      toast.success(publish ? 'Article published.' : publish === false ? 'Article unpublished.' : 'Draft saved.');
      onBack();
    } catch (e) {
      const fe = reportError(e);
      if (fe) setErrs(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Gate perms={['content.write']}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="tertiary" leadingIcon="arrow-left" onClick={onBack}>All content</Button>
        <span className="hidden gap-2 laptop:flex">
          <Button variant="secondary" loading={busy} onClick={() => void save()}>Save draft</Button>
          {article?.published_at ? <Button variant="secondary" onClick={() => void save(false)}>Unpublish</Button> : null}
          <Button loading={busy} onClick={() => void save(true)}>Publish</Button>
        </span>
      </div>
      <div className="grid gap-5 desktop:grid-cols-2">
        <Section title={id ? 'Edit article' : 'New article'}>
          <div className="space-y-4">
            <Select label="Topic" value={f.topic_id || null} error={errs.topic_id} options={topics.map((t) => ({ value: t.id, label: t.title }))} onChange={(v) => setF({ ...f, topic_id: v })} />
            <Field label="Title" value={f.title} error={errs.title} onChange={(e) => setF({ ...f, title: e.target.value, slug: slugEdited ? f.slug : slugify(e.target.value) })} />
            <Field label="Slug" value={f.slug} error={errs.slug} onChange={(e) => { setSlugEdited(true); setF({ ...f, slug: e.target.value }); }} />
            <Field label="Summary" optional value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
            <Textarea label="Body (Markdown)" value={f.body_md} error={errs.body_md} onChange={(e) => setF({ ...f, body_md: e.target.value })} autoGrow={false} rows={14} />
            <Switch label="Popular" checked={f.is_popular} onCheckedChange={(v) => setF({ ...f, is_popular: v })} />
            {f.is_popular ? <Field label="Popular label" value={f.popular_label} onChange={(e) => setF({ ...f, popular_label: e.target.value })} /> : null}
          </div>
        </Section>
        <Section title="Preview">
          <h2 className="mb-2 font-display text-h4 text-fg">{f.title || 'Untitled'}</h2>
          <Md text={f.body_md} />
        </Section>
      </div>
    </Gate>
  );
}

function Legal() {
  const u = useUrlState();
  const slug = u.get('slug', 'terms');
  const data = useApi<{ slug: string; versions: LegalV[] }>(`/admin/content/legal/${slug}`);
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [view, setView] = useState<LegalV | null>(null);
  const names: Record<string, string> = { terms: 'Terms & conditions', privacy: 'Privacy policy', refund: 'Refund policy', cancellation: 'Cancellation policy' };
  const publish: ActionSpec = {
    title: 'Publish a new version',
    description: "This becomes the live page right away and the old version moves to history. It can't be edited after this. The text is supplied by the client.",
    confirm: 'Publish version',
    width: 560,
    fields: [
      { name: 'version', type: 'text', label: 'Version', required: true, max: 20, placeholder: '1.1' },
      { name: 'title', type: 'text', label: 'Title', required: true, max: 80, default: names[slug] },
      { name: 'body_md', type: 'textarea', label: 'Text (Markdown)', required: true, max: 200000 },
      { name: 'effective_at', type: 'date', label: 'Effective date', required: true },
      ...(slug === 'terms' || slug === 'privacy' ? [{ name: 'require_reaccept', type: 'switch' as const, label: 'Ask every user to accept again' }] : []),
    ],
    extra: (v) => (v.require_reaccept ? <Alert tone="warning">Every user must accept it again at next sign-in.</Alert> : null),
    confirmLabel: (v) => `Publish version ${v.version || ''}`.trim(),
    submit: (v) => post(`/admin/content/legal/${slug}`, { version: v.version, title: v.title, body_md: v.body_md, effective_at: new Date(`${v.effective_at}T00:00:00+06:00`).toISOString(), require_reaccept: v.require_reaccept === true }),
    success: 'Version published.',
    onDone: data.reload,
  };
  return (
    <div className="grid gap-5 desktop:grid-cols-[240px_1fr]">
      <nav aria-label="Legal pages" className="space-y-1">
        {Object.entries(names).map(([k, n]) => (
          <button key={k} type="button" onClick={() => { u.set({ slug: k }); setView(null); }} aria-current={slug === k ? 'page' : undefined} className={`block w-full rounded-[10px] px-3 py-2 text-left text-label-md ${slug === k ? 'bg-brand-subtle text-fg-brand' : 'text-fg-secondary hover:bg-subtle'}`}>{n}</button>
        ))}
      </nav>
      <div className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-h5 text-fg">{names[slug]} · /legal/{slug}</h2><span className="hidden laptop:inline"><Button onClick={() => setSpec(publish)}>New version</Button></span></div>
        <Table<LegalV> caption="Versions" rows={data.data?.versions} loading={data.loading} rowKey={(v) => v.id} onRowClick={setView} empty={<EmptyState title="No version published yet" body={`/legal/${slug} shows a placeholder until a version is published.`} compact />} cols={[{ key: 'v', header: 'Version', cell: (v) => v.version }, { key: 't', header: 'Title', cell: (v) => v.title }, { key: 'e', header: 'Effective', cell: (v) => dt(v.effective_at) }, { key: 'c', header: 'Current', cell: (v) => (v.is_current ? <span className="rounded-full bg-success-subtle px-2 text-label-sm text-fg-success">Current</span> : '—') }, { key: 'p', header: 'Published by', cell: (v) => v.published_by ?? '—' }]} />
        {view ? <Section title={`Version ${view.version} (read-only)`}><Md text={view.body_md} /></Section> : null}
      </div>
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
