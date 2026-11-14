/** The shipped catalog. Validated when the module loads: a bad entry fails the
 * tests and the build's first run, never a match in progress. To add a class,
 * a kingdom rite or a named style, add a file and list it here. */
import { createCatalog, type Sequence } from "../choreography";
import { BISHOP_SEQUENCES } from "./bishop";
import { KING_SEQUENCES } from "./king";
import { KNIGHT_SEQUENCES } from "./knight";
import { NAMED_SEQUENCES } from "./named";
import { PAWN_SEQUENCES } from "./pawn";
import { QUEEN_SEQUENCES } from "./queen";
import { ROOK_SEQUENCES } from "./rook";

export const CATALOG: readonly Sequence[] = createCatalog(
  PAWN_SEQUENCES, KNIGHT_SEQUENCES, ROOK_SEQUENCES, BISHOP_SEQUENCES, QUEEN_SEQUENCES, KING_SEQUENCES, NAMED_SEQUENCES,
);
export { BISHOP_SEQUENCES, KING_SEQUENCES, KNIGHT_SEQUENCES, NAMED_SEQUENCES, PAWN_SEQUENCES, QUEEN_SEQUENCES, ROOK_SEQUENCES };
