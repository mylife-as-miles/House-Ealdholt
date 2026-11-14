/** Canonical baked material set. Quest consumes a lit colour bake of these same surfaces. */
export const ATLAS_BOOK_MATERIALS = {
  root: '/assets/chronicles/book-cover-v1/',
  color: 'book-basecolor.webp',
  normal: 'book-normal.webp',
  orm: 'book-orm.webp',
  quest: 'book-quest.webp',
  questAsset: 'chronicles-atlas-book-cover-v1',
  size: 2048,
  // Pixel rectangles include an inset from the padded island boundary.
  islands: {
    leather: [16, 16, 1344, 2000],
    bronze: [1392, 16, 640, 640],
    paper: [1392, 704, 640, 320],
  },
} as const;
