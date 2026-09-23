"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VNDIRECT_SYMBOLS, type SymbolItem } from "./SymbolSearchModal";

interface CompareSymbolModalProps {
  isOpen: boolean;
  selectedSymbols: string[];
  recentSymbols: string[];
  onAddSymbol: (symbol: string) => void;
  onRemoveSymbol: (symbol: string) => void;
  onClose: () => void;
}

function SearchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="22" height="22" fill="none" aria-hidden="true">
      <path stroke="currentColor" d="M12.4 12.5a7 7 0 1 0-4.9 2 7 7 0 0 0 4.9-2zm0 0 5.101 5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path stroke="currentColor" strokeWidth="1.5" d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path stroke="currentColor" strokeWidth="1.8" d="m4 12 5 5L20 6" />
    </svg>
  );
}

function displayType(item: SymbolItem) {
  return item.type === "CHỈ SỐ" ? "INDEX" : item.type;
}

function highlightMatch(value: string, query: string) {
  if (!query) return value;
  const index = value.toUpperCase().indexOf(query);
  if (index === -1) return value;
  return (
    <>
      {value.slice(0, index)}
      <span className="compare-symbol-modal__highlight">{value.slice(index, index + query.length)}</span>
      {value.slice(index + query.length)}
    </>
  );
}

function SymbolRow({
  item,
  selected,
  showCheck,
  query = "",
  showActions = false,
  onClick,
}: {
  item: SymbolItem;
  selected: boolean;
  showCheck: boolean;
  query?: string;
  showActions?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`compare-symbol-modal__row${showActions ? " compare-symbol-modal__row--actions" : ""}${selected ? " compare-symbol-modal__row--selected" : ""}`}
      role="button"
      onClick={onClick}
    >
      <span className="compare-symbol-modal__identity">
        <span className="compare-symbol-modal__symbol">{highlightMatch(item.symbol, query)}</span>
        <span className="compare-symbol-modal__description">
          {query ? highlightMatch(item.description, query) : item.symbol}
        </span>
      </span>
      <span className="compare-symbol-modal__market">
        <span>{item.exchange}</span>
        <span>{displayType(item)}</span>
      </span>
      {showCheck && (
        <span className={selected ? "compare-symbol-modal__check compare-symbol-modal__check--selected" : "compare-symbol-modal__check"}>
          {selected && <CheckIcon />}
        </span>
      )}
      {showActions && (
        <span className="compare-symbol-modal__actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" tabIndex={-1} className="compare-symbol-modal__action">Cùng % quy mô</button>
          <button type="button" tabIndex={-1} className="compare-symbol-modal__action">Khung giá mới</button>
          <button type="button" tabIndex={-1} className="compare-symbol-modal__action">Ngăn mới</button>
        </span>
      )}
    </div>
  );
}

export function CompareSymbolModal({
  isOpen,
  selectedSymbols,
  recentSymbols,
  onAddSymbol,
  onRemoveSymbol,
  onClose,
}: CompareSymbolModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropPointerDownRef = useRef(false);
  const selectedItems = useMemo(() => VNDIRECT_SYMBOLS.filter((item) => selectedSymbols.includes(item.symbol)), [selectedSymbols]);
  const recentItems = useMemo(() => recentSymbols
    .map((symbol) => VNDIRECT_SYMBOLS.find((item) => item.symbol === symbol))
    .filter((item): item is SymbolItem => Boolean(item)), [recentSymbols]);
  const searchResults = useMemo(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];
    return VNDIRECT_SYMBOLS.filter((item) => (
      item.symbol.includes(normalizedQuery) || item.description.toUpperCase().includes(normalizedQuery)
    ));
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") event.preventDefault();
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleSymbol = (symbol: string) => {
    if (selectedSymbols.includes(symbol)) onRemoveSymbol(symbol);
    else onAddSymbol(symbol);
  };

  const visibleItems = query ? searchResults : recentItems;

  return (
    <div
      className="compare-symbol-modal__backdrop"
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPointerDownRef.current && event.target === event.currentTarget) onClose();
        backdropPointerDownRef.current = false;
      }}
    >
      <section className="compare-symbol-modal" role="dialog" aria-modal="true" aria-labelledby="compare-symbol-title">
        <header className="compare-symbol-modal__header">
          <h2 id="compare-symbol-title">So sánh mã</h2>
          <button type="button" tabIndex={-1} className="compare-symbol-modal__close" onClick={onClose} aria-label="Close compare symbols">
            <CloseIcon />
          </button>
        </header>
        <div className="compare-symbol-modal__search">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value.toUpperCase())}
            placeholder="Tìm kiếm"
            data-clear-selection-on-outside-drag
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {selectedItems.length > 0 && !query && (
          <div className="compare-symbol-modal__section">
            <h3>CÁC MÃ ĐÃ THÊM</h3>
            {selectedItems.map((item) => (
              <SymbolRow key={item.symbol} item={item} selected showCheck onClick={() => toggleSymbol(item.symbol)} />
            ))}
          </div>
        )}
        <div className={query ? "compare-symbol-modal__section compare-symbol-modal__section--results" : "compare-symbol-modal__section compare-symbol-modal__section--recent"}>
          <h3>{query ? "MÃ GIAO DỊCH & MÔ TẢ" : "CÁC MÃ GẦN ĐÂY"}</h3>
          <div className="compare-symbol-modal__rows">
            {visibleItems.map((item) => (
              <SymbolRow
                key={item.symbol}
                item={item}
                selected={selectedSymbols.includes(item.symbol)}
                showCheck={false}
                query={query}
                showActions
                onClick={() => toggleSymbol(item.symbol)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
