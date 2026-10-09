// Search terms in SQL LIKE patterns. The statement adds `ESCAPE '\'` after
// the pattern, so a `%`, `_` or `\` the user typed matches itself.

/** A term to find anywhere in a column: `%term%`, with LIKE wildcards escaped. */
export function likePattern(term: string): string {
	return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
