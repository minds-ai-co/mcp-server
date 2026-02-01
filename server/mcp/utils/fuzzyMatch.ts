/**
 * Fuzzy string matching utilities for MCP server
 * Used for finding sparks by name with partial matches
 */

/**
 * Calculate similarity score between two strings
 * @returns Score from 0-100, higher means more similar
 */
export function fuzzyMatch(search: string, target: string): number {
  const searchLower = search.toLowerCase().trim()
  const targetLower = target.toLowerCase().trim()

  // Exact match (case-insensitive)
  if (searchLower === targetLower) return 100

  // Target contains search
  if (targetLower.includes(searchLower)) return 80

  // Target starts with search
  if (targetLower.startsWith(searchLower)) return 90

  // Calculate Levenshtein distance-based similarity
  const maxLen = Math.max(searchLower.length, targetLower.length)
  const distance = levenshteinDistance(searchLower, targetLower)
  const similarity = ((maxLen - distance) / maxLen) * 70 // Max 70 for partial matches

  return similarity
}

/**
 * Calculate Levenshtein (edit) distance between two strings
 * Lower distance means more similar
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Find the best matching item from a list
 * @returns The best match and its score, or null if no good match found
 */
export function findBestMatch<T>(
  search: string,
  items: T[],
  getName: (item: T) => string,
  minScore: number = 50
): { item: T; score: number } | null {
  let bestMatch: T | null = null
  let bestScore = 0

  for (const item of items) {
    const score = fuzzyMatch(search, getName(item))
    if (score > bestScore) {
      bestScore = score
      bestMatch = item
    }
  }

  if (!bestMatch || bestScore < minScore) {
    return null
  }

  return { item: bestMatch, score: bestScore }
}
