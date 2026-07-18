import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { useState } from "react";

/**
 * Reusable pager for long tables/reports: rows-per-page select, total count,
 * page X/Y, jump-to-page input, first/prev/next/last. Renders nothing when
 * there are zero records. Stacks compactly under 768px (see admin.css).
 */
export default function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
}) {
  const [jumpValue, setJumpValue] = useState("");
  if (!total) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);

  const goTo = (p) => onPageChange(Math.min(Math.max(1, p), totalPages));

  const submitJump = (e) => {
    e.preventDefault();
    const n = parseInt(jumpValue, 10);
    if (Number.isFinite(n)) goTo(n);
    setJumpValue("");
  };

  return (
    <div className="ff-pagination">
      <div className="ff-pagination-size">
        <label htmlFor="ff-pagination-rows">Rows</label>
        <select
          id="ff-pagination-rows"
          className="ff-select-sm"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="ff-pagination-total">{total.toLocaleString("en-IN")} total</span>
      </div>

      <div className="ff-pagination-nav">
        <button className="ff-icon-btn" disabled={clampedPage <= 1} onClick={() => goTo(1)} aria-label="First page"><ChevronsLeft size={15} /></button>
        <button className="ff-icon-btn" disabled={clampedPage <= 1} onClick={() => goTo(clampedPage - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
        <span className="ff-pagination-page">Page {clampedPage} / {totalPages}</span>
        <button className="ff-icon-btn" disabled={clampedPage >= totalPages} onClick={() => goTo(clampedPage + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
        <button className="ff-icon-btn" disabled={clampedPage >= totalPages} onClick={() => goTo(totalPages)} aria-label="Last page"><ChevronsRight size={15} /></button>

        <form className="ff-pagination-jump" onSubmit={submitJump}>
          <input
            type="number" min={1} max={totalPages} placeholder="Go to…"
            value={jumpValue} onChange={(e) => setJumpValue(e.target.value)}
          />
        </form>
      </div>
    </div>
  );
}
