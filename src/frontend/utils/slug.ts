export function buildSessionSlug(session: { name: string; id: string }): string {
  return `${session.name}-${session.id}`;
}

export function parseSessionSlug(slug: string): { name: string; id: string } {
  return {
    name: slug.slice(0, -37),
    id: slug.slice(-36),
  };
}
