"use client";

import React from "react";
import { ChevronUp, ChevronDown, Maximize2, Minimize2, Terminal, Filter, Layers, PlayCircle } from "lucide-react";
import PositionsTable from "@/components/PositionsTable";
import ScreenerPanel from "@/components/ScreenerPanel";
import OrderFlowSuite from "@/components/OrderFlowSuite";
import BarReplayPanel from "@/components/BarReplayPanel";
import { formatNumber, getCurrencySymbol } from "@/lib/format";
import { OrderHistoryItem, PendingOrder, Position } from "@/types/trading";

export type BottomDrawerTab = "paper" | "screener" | "orderflow" | "replay";

interface BottomTerminalDrawerProps {
  isOpen: boolean;
  isExpanded: boolean;
  onToggleOpen: () => void;
  onToggleExpand: () => void;
  activeTab: BottomDrawerTab;
  onSelectTab: (tab: BottomDrawerTab) => void;
  selectedSymbol: string;
  activeCurrency: string;
  walletBalance: number;
  positions: Position[];
  pendingOrders: PendingOrder[];
  ordersHistory: OrderHistoryItem[];
  rejectedOrders?: OrderHistoryItem[];
  onClosePosition: (symbol: string, quantity: number, orderType: string, productType?: string) => void;
  onCancelPending: (orderId: string) => void;
  onSquareOffAll?: () => void;
  onSelectSymbolFromScreener: (symbol: string) => void;
}

export default function BottomTerminalDrawer({
  isOpen,
  isExpanded,
  onToggleOpen,
  onToggleExpand,
  activeTab,
  onSelectTab,
  selectedSymbol,
  activeCurrency,
  walletBalance,
  positions,
  pendingOrders,
  ordersHistory,
  rejectedOrders = [],
  onClosePosition,
  onCancelPending,
  onSquareOffAll,
  onSelectSymbolFromScreener,
}: BottomTerminalDrawerProps) {
  const currencyPositions = positions.filter(
    (p) => p.currency === activeCurrency || (activeCurrency === "GBP" && p.currency === "GBp")
  );

  // Convert GBp (pence) -> GBP (pounds) accurately when activeCurrency is GBP
  const scaleFor = (posCurrency: string) => (activeCurrency === "GBP" && posCurrency === "GBp" ? 0.01 : 1);

  const totalUnrealizedPnl = currencyPositions.reduce(
    (acc, p) => acc + (p.pnl || 0) * scaleFor(p.currency),
    0
  );
  const openPositionEquity = currencyPositions.reduce((acc, p) => {
    const sc = scaleFor(p.currency);
    const mb = (p.margin_blocked ?? p.avg_price * p.quantity / (p.leverage || 1)) * sc;
    const pnl = (p.pnl || 0) * sc;
    return acc + mb + pnl;
  }, 0);
  const currSym = getCurrencySymbol(activeCurrency);
  const equity = walletBalance + openPositionEquity;

  const tabs: Array<{ id: BottomDrawerTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "paper", label: `Paper Trading (${positions.length})`, icon: Terminal },
    { id: "screener", label: "Stock Screener", icon: Filter },
    { id: "orderflow", label: "Order Flow Suite", icon: Layers },
    { id: "replay", label: "Bar Replay", icon: PlayCircle },
  ];

  const handleTabClick = (tab: BottomDrawerTab) => {
    if (!isOpen) onToggleOpen();
    onSelectTab(tab);
  };

  return (
    <div
      className={`bg-[#FFFFFF] flex flex-col shrink-0 border-t border-[#E0E3EB] transition-all ${
        !isOpen ? "h-[38px]" : isExpanded ? "h-[400px]" : "h-[235px]"
      }`}
    >
      {/* TradingView Bottom Panel Tab Bar */}
      <div className="h-[38px] px-3 flex items-center justify-between gap-2 border-b border-[#E0E3EB] shrink-0">
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto scrollbar-none">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = isOpen && activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleTabClick(t.id)}
                className={`px-2.5 py-1.5 text-xs font-bold flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
                  active
                    ? "border-[#131722] text-[#131722]"
                    : "border-transparent text-[#787B86] hover:text-[#131722]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Account Summary Metrics + Collapse/Expand Controls */}
        <div className="flex items-center gap-3 text-[11px] shrink-0">
          <div className="hidden xl:flex items-center gap-3 font-mono tabular-nums">
            <span className="text-[#787B86]">
              Balance ({activeCurrency}):{" "}
              <strong suppressHydrationWarning className="text-[#131722]">
                {currSym}
                {formatNumber(walletBalance, 2)}
              </strong>
            </span>
            <span className="text-[#787B86]">
              Equity:{" "}
              <strong suppressHydrationWarning className="text-[#131722]">
                {currSym}
                {formatNumber(equity, 2)}
              </strong>
            </span>
            <span className="text-[#787B86]">
              Open P&amp;L:{" "}
              <strong className={totalUnrealizedPnl >= 0 ? "text-[#089981]" : "text-[#F23645]"}>
                {totalUnrealizedPnl >= 0 ? "+" : "-"}
                {currSym}
                {formatNumber(Math.abs(totalUnrealizedPnl), 2)}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-1">
            {isOpen && (
              <button
                type="button"
                onClick={onToggleExpand}
                aria-label={isExpanded ? "Restore Bottom Panel Height" : "Maximize Bottom Panel Height"}
                title={isExpanded ? "Restore Height" : "Expand Panel"}
                className="p-1 rounded hover:bg-[#F0F3FA] text-[#787B86] hover:text-[#131722] transition"
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={onToggleOpen}
              aria-label={isOpen ? "Collapse Bottom Panel" : "Expand Bottom Panel"}
              title={isOpen ? "Collapse Bottom Panel" : "Open Bottom Panel"}
              className="p-1 rounded hover:bg-[#F0F3FA] text-[#787B86] hover:text-[#131722] transition"
            >
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Drawer Body */}
      {isOpen && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-[#FFFFFF]">
          {activeTab === "paper" && (
            <PositionsTable
              positions={positions}
              pendingOrders={pendingOrders}
              ordersHistory={ordersHistory}
              rejectedOrders={rejectedOrders}
              onClosePosition={onClosePosition}
              onCancelPending={onCancelPending}
              onSquareOffAll={onSquareOffAll}
            />
          )}
          {activeTab === "screener" && (
            <ScreenerPanel onSelectSymbol={onSelectSymbolFromScreener} />
          )}
          {activeTab === "orderflow" && (
            <OrderFlowSuite symbol={selectedSymbol} />
          )}
          {activeTab === "replay" && (
            <BarReplayPanel key={selectedSymbol} defaultSymbol={selectedSymbol} />
          )}
        </div>
      )}
    </div>
  );
}
