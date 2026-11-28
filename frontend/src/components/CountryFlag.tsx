"use client";

import React from "react";

interface CountryFlagProps {
  code?: string | null;
  className?: string;
}

export default function CountryFlag({ code = "ALL", className = "w-4 h-3" }: CountryFlagProps) {
  const norm = (code || "ALL").toUpperCase();

  if (norm === "IND" || norm === "IN") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-black/15 ${className}`} aria-label="India flag">
        <rect width="24" height="5.33" y="0" fill="#FF9933" />
        <rect width="24" height="5.34" y="5.33" fill="#FFFFFF" />
        <rect width="24" height="5.33" y="10.67" fill="#138808" />
        <circle cx="12" cy="8" r="1.9" fill="none" stroke="#000080" strokeWidth="0.9" />
        <circle cx="12" cy="8" r="0.5" fill="#000080" />
      </svg>
    );
  }

  if (norm === "USA" || norm === "US") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-black/15 ${className}`} aria-label="USA flag">
        <rect width="24" height="16" fill="#B22234" />
        <rect width="24" height="1.23" y="1.23" fill="#FFFFFF" />
        <rect width="24" height="1.23" y="3.69" fill="#FFFFFF" />
        <rect width="24" height="1.23" y="6.15" fill="#FFFFFF" />
        <rect width="24" height="1.23" y="8.61" fill="#FFFFFF" />
        <rect width="24" height="1.23" y="11.07" fill="#FFFFFF" />
        <rect width="24" height="1.23" y="13.53" fill="#FFFFFF" />
        <rect width="10.5" height="8.6" x="0" y="0" fill="#3C3B6E" />
        <circle cx="2.5" cy="2.2" r="0.55" fill="#FFFFFF" />
        <circle cx="5.2" cy="2.2" r="0.55" fill="#FFFFFF" />
        <circle cx="7.9" cy="2.2" r="0.55" fill="#FFFFFF" />
        <circle cx="3.8" cy="4.3" r="0.55" fill="#FFFFFF" />
        <circle cx="6.6" cy="4.3" r="0.55" fill="#FFFFFF" />
        <circle cx="2.5" cy="6.4" r="0.55" fill="#FFFFFF" />
        <circle cx="5.2" cy="6.4" r="0.55" fill="#FFFFFF" />
        <circle cx="7.9" cy="6.4" r="0.55" fill="#FFFFFF" />
      </svg>
    );
  }

  if (norm === "CANADA" || norm === "CA") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-black/15 ${className}`} aria-label="Canada flag">
        <rect width="24" height="16" fill="#FFFFFF" />
        <rect width="6" height="16" x="0" fill="#D80621" />
        <rect width="6" height="16" x="18" fill="#D80621" />
        <path
          d="M12 3.2L13.1 6.2L15.4 5.5L14.3 8.1L16.1 9.1L13.2 10.1L13.5 11.4L12 10.9V13H11.6V10.9L10.1 11.4L10.4 10.1L7.5 9.1L9.3 8.1L8.2 5.5L10.5 6.2L11.6 3.2Z"
          fill="#D80621"
        />
      </svg>
    );
  }

  if (norm === "CHINA" || norm === "CN") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-black/15 ${className}`} aria-label="China flag">
        <rect width="24" height="16" fill="#DE2910" />
        <polygon points="4.5,2.2 5.2,4.4 7.5,4.4 5.6,5.7 6.3,7.9 4.5,6.5 2.7,7.9 3.4,5.7 1.5,4.4 3.8,4.4" fill="#FFDE00" />
        <circle cx="8.8" cy="2.5" r="0.65" fill="#FFDE00" />
        <circle cx="10.0" cy="4.1" r="0.65" fill="#FFDE00" />
        <circle cx="9.9" cy="6.1" r="0.65" fill="#FFDE00" />
        <circle cx="8.5" cy="7.5" r="0.65" fill="#FFDE00" />
      </svg>
    );
  }

  if (norm === "UK" || norm === "GB") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-black/15 ${className}`} aria-label="UK flag">
        <rect width="24" height="16" fill="#012169" />
        <path d="M0 0L24 16M24 0L0 16" stroke="#FFFFFF" strokeWidth="2.8" />
        <path d="M0 0L24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.4" />
        <path d="M12 0V16M0 8H24" stroke="#FFFFFF" strokeWidth="4.2" />
        <path d="M12 0V16M0 8H24" stroke="#C8102E" strokeWidth="2.4" />
      </svg>
    );
  }

  if (norm === "CRYPTO") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-amber-500/40 ${className}`} aria-label="Crypto Market">
        <rect width="24" height="16" fill="#0F172A" />
        <circle cx="12" cy="8" r="5.6" fill="#F59E0B" />
        <path d="M10.4 5.2H13.1C14.1 5.2 14.7 5.7 14.7 6.5C14.7 7.1 14.3 7.6 13.7 7.8C14.5 8 15 8.6 15 9.4C15 10.3 14.2 10.9 13.1 10.9H10.4V5.2ZM11.6 7.4H12.9C13.3 7.4 13.6 7.1 13.6 6.7C13.6 6.3 13.3 6.1 12.9 6.1H11.6V7.4ZM11.6 9.9H13C13.5 9.9 13.8 9.6 13.8 9.2C13.8 8.7 13.5 8.4 13 8.4H11.6V9.9Z" fill="#0F172A" />
      </svg>
    );
  }

  if (norm === "FOREX" || norm === "FX") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-sky-500/40 ${className}`} aria-label="Forex Market">
        <rect width="24" height="16" fill="#0284C7" />
        <path d="M4 5.5H16M13.5 3.2L16 5.5L13.5 7.8" stroke="#FFFFFF" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 10.5H8M10.5 8.2L8 10.5L10.5 12.8" stroke="#BAE6FD" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (norm === "EU") {
    return (
      <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-black/15 ${className}`} aria-label="EU flag">
        <rect width="24" height="16" fill="#003399" />
        <circle cx="12" cy="3.2" r="0.7" fill="#FFCC00" />
        <circle cx="14.5" cy="3.9" r="0.7" fill="#FFCC00" />
        <circle cx="16.2" cy="5.7" r="0.7" fill="#FFCC00" />
        <circle cx="16.8" cy="8.0" r="0.7" fill="#FFCC00" />
        <circle cx="16.2" cy="10.3" r="0.7" fill="#FFCC00" />
        <circle cx="14.5" cy="12.1" r="0.7" fill="#FFCC00" />
        <circle cx="12" cy="12.8" r="0.7" fill="#FFCC00" />
        <circle cx="9.5" cy="12.1" r="0.7" fill="#FFCC00" />
        <circle cx="7.8" cy="10.3" r="0.7" fill="#FFCC00" />
        <circle cx="7.2" cy="8.0" r="0.7" fill="#FFCC00" />
        <circle cx="7.8" cy="5.7" r="0.7" fill="#FFCC00" />
        <circle cx="9.5" cy="3.9" r="0.7" fill="#FFCC00" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 16" className={`inline-block shrink-0 rounded-[2px] border border-slate-300 dark:border-slate-600 ${className}`} aria-label="Global markets">
      <rect width="24" height="16" fill="#0F172A" />
      <circle cx="12" cy="8" r="5" fill="none" stroke="#38BDF8" strokeWidth="1.2" />
      <ellipse cx="12" cy="8" rx="2.3" ry="5" fill="none" stroke="#38BDF8" strokeWidth="0.9" />
      <line x1="7" y1="8" x2="17" y2="8" stroke="#38BDF8" strokeWidth="0.9" />
    </svg>
  );
}
