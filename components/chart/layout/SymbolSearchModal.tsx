"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export interface SymbolItem {
  symbol: string;
  description: string;
  type: string;
  exchange: string;
}

export const VNDIRECT_SYMBOLS: SymbolItem[] = [
  {
    symbol: "VN30",
    description: "VN30",
    type: "CHỈ SỐ",
    exchange: "HOSE",
  },
  {
    symbol: "VN30F2Q",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 QUÝ TIẾP THEO",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F2M",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 THÁNG TIẾP THEO",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F2512",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 THÁNG 12/2025",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F2509",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 THÁNG 9/2025",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F2506",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 THÁNG 06/2025",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F2505",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 THÁNG 5/2025",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F2503",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 THÁNG 03/2025",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F1M",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 THÁNG HIỆN TẠI",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VN30F1Q",
    description: "HỢP ĐỒNG TƯƠNG LAI CHỈ SỐ VN30 QUÝ HIỆN TẠI",
    type: "HĐ TƯƠNG LAI",
    exchange: "HNX",
  },
  {
    symbol: "VNINDEX",
    description: "VN-INDEX",
    type: "CHỈ SỐ",
    exchange: "HOSE",
  },
  {
    symbol: "HNX",
    description: "HNX-INDEX",
    type: "CHỈ SỐ",
    exchange: "HNX",
  },
  {
    symbol: "HNX30",
    description: "HNX30-INDEX",
    type: "CHỈ SỐ",
    exchange: "HNX",
  },
  {
    symbol: "UPCOM",
    description: "UPCoM-INDEX",
    type: "CHỈ SỐ",
    exchange: "UPCOM",
  },
  {
    symbol: "SSI",
    description: "CTCP Chứng khoán SSI",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "VND",
    description: "CTCP Chứng khoán VNDIRECT",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "FPT",
    description: "CTCP FPT",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "VCB",
    description: "Ngân hàng TMCP Ngoại thương Việt Nam",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "HPG",
    description: "CTCP Tập đoàn Hòa Phát",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "VIC",
    description: "Tập đoàn Vingroup - CTCP",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "VHM",
    description: "CTCP Vinhomes",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "VNM",
    description: "CTCP Sữa Việt Nam",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "MWG",
    description: "CTCP Đầu tư Thế Giới Di Động",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "TCB",
    description: "Ngân hàng TMCP Kỹ thương Việt Nam",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "MBB",
    description: "Ngân hàng TMCP Quân đội",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "VPB",
    description: "Ngân hàng TMCP Việt Nam Thịnh Vượng",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "ACB",
    description: "Ngân hàng TMCP Á Châu",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "STB",
    description: "Ngân hàng TMCP Sài Gòn Thương Tín",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "MSN",
    description: "CTCP Tập đoàn Masan",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "GAS",
    description: "Tổng Công ty Khí Việt Nam - CTCP",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "BID",
    description: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
  {
    symbol: "CTG",
    description: "Ngân hàng TMCP Công Thương Việt Nam",
    type: "CỔ PHIẾU",
    exchange: "HOSE",
  },
];

interface SymbolSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string) => void;
  currentSymbol: string;
  initialQuery?: string;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text;

  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);

  return (
    <>
      {before}
      <span className="symbol-search-modal__highlight">{match}</span>
      {after}
    </>
  );
}

export function SymbolSearchModal({
  isOpen,
  onClose,
  onSelectSymbol,
  currentSymbol,
  initialQuery = "",
}: SymbolSearchModalProps) {
  const [query, setQuery] = useState(initialQuery || currentSymbol);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery || currentSymbol);
      setSelectedIndex(0);
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialQuery, currentSymbol]);

  const filteredSymbols = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return VNDIRECT_SYMBOLS;
    return VNDIRECT_SYMBOLS.filter(
      (item) =>
        item.symbol.toLowerCase().includes(trimmed) ||
        item.description.toLowerCase().includes(trimmed)
    );
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredSymbols]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredSymbols.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSymbols.length - 1
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredSymbols[selectedIndex]) {
          onSelectSymbol(filteredSymbols[selectedIndex].symbol);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedIndex, filteredSymbols, onClose, onSelectSymbol]);

  useEffect(() => {
    if (listRef.current && listRef.current.children[selectedIndex]) {
      const el = listRef.current.children[selectedIndex] as HTMLElement;
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="symbol-search-modal__backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="symbol-search-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-search-title"
      >
        <div className="symbol-search-modal__header">
          <h2 id="symbol-search-title" className="symbol-search-modal__title">
            Tìm kiếm Mã giao dịch
          </h2>
          <button
            type="button"
            className="symbol-search-modal__close-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="currentColor"
            >
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="symbol-search-modal__input-row">
          <span className="symbol-search-modal__search-icon" aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
            >
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            className="symbol-search-modal__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm kiếm"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="symbol-search-modal__clear-btn"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Xóa nội dung tìm kiếm"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
              >
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          )}
        </div>

        <div className="symbol-search-modal__table-header">
          <span className="symbol-search-modal__col-symbol">MÃ</span>
          <span className="symbol-search-modal__col-desc">MÔ TẢ</span>
        </div>

        <div ref={listRef} className="symbol-search-modal__list">
          {filteredSymbols.length > 0 ? (
            filteredSymbols.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.symbol}
                  className={`symbol-search-modal__row ${
                    isSelected ? "symbol-search-modal__row--selected" : ""
                  }`}
                  onClick={() => {
                    onSelectSymbol(item.symbol);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="symbol-search-modal__cell-symbol">
                    {highlightMatch(item.symbol, query)}
                  </div>
                  <div className="symbol-search-modal__cell-desc">
                    {highlightMatch(item.description, query)}
                  </div>
                  <div className="symbol-search-modal__cell-meta">
                    <span className="symbol-search-modal__meta-type">
                      {item.type}
                    </span>
                    <span className="symbol-search-modal__meta-exchange">
                      {item.exchange}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="symbol-search-modal__empty">
              Không có mã giao dịch nào khớp với tiêu chí của bạn
            </div>
          )}
        </div>

        <div className="symbol-search-modal__footer">
          Chỉ cần bắt đầu nhập khi đang ở trên biểu đồ để kéo lên hộp tìm kiếm này
        </div>
      </div>
    </div>
  );
}
