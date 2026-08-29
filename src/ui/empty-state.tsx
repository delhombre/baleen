export function EmptyState() {
  return (
    <main
      aria-labelledby="empty-state-title"
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center text-slate-50"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Baleen</p>
      <h1 id="empty-state-title" className="text-2xl font-semibold tracking-tight">
        Aucune fiche pour le moment
      </h1>
      <p className="max-w-xs text-sm leading-6 text-slate-300">
        Capturez une page produit pour commencer.
      </p>
    </main>
  );
}
