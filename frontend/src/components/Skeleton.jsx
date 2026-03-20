import React from 'react';
import './Skeleton.css';

export function SkeletonBlock({ width, height, circle, style }) {
  return (
    <div
      className={`skeleton ${circle ? 'skeleton-circle' : ''}`}
      style={{ width, height, ...style }}
    />
  );
}

export function DeviceItemSkeleton() {
  return (
    <div className="skeleton-device-item">
      <div className="skeleton skeleton-circle skeleton-avatar" />
      <div className="skeleton-lines">
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
        <div className="skeleton skeleton-text skeleton-text-short" />
      </div>
      <div className="skeleton skeleton-status" />
    </div>
  );
}

function SectionHeaderSkeleton({ width = 120 }) {
  return (
    <div className="skeleton-section-header">
      <div className="skeleton" style={{ width }} />
    </div>
  );
}

export function DeviceListSkeleton({ count = 6 }) {
  // Mimic real layout: "Recent Devices" header + some items, then "All Devices" header + remaining
  const recentCount = Math.min(2, count);
  const allCount = count - recentCount;
  return (
    <>
      <SectionHeaderSkeleton width={110} />
      {Array.from({ length: recentCount }, (_, i) => (
        <DeviceItemSkeleton key={`r-${i}`} />
      ))}
      {allCount > 0 && (
        <>
          <SectionHeaderSkeleton width={80} />
          {Array.from({ length: allCount }, (_, i) => (
            <DeviceItemSkeleton key={`a-${i}`} />
          ))}
        </>
      )}
    </>
  );
}

export function ServiceItemSkeleton() {
  return (
    <div className="skeleton-service-item">
      {/* Row 1: name + status dot + status text */}
      <div className="skeleton-service-row">
        <div className="skeleton skeleton-text" style={{ width: '40%', height: '16px' }} />
        <div className="skeleton skeleton-circle" style={{ width: 8, height: 8 }} />
        <div className="skeleton skeleton-text" style={{ width: '15%', height: '12px' }} />
      </div>
      {/* Row 2: meta — IPs */}
      <div className="skeleton-service-row">
        <div className="skeleton skeleton-text" style={{ width: '30%', height: '12px' }} />
      </div>
      {/* Row 3: IP button placeholders */}
      <div className="skeleton-service-row">
        <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 4 }} />
        <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 4 }} />
      </div>
      {/* Row 4: action buttons */}
      <div className="skeleton-service-actions">
        <div className="skeleton" style={{ width: 60, height: 28, borderRadius: 6 }} />
        <div className="skeleton" style={{ width: 60, height: 28, borderRadius: 6 }} />
      </div>
    </div>
  );
}

export function ServicesListSkeleton({ count = 3 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <ServiceItemSkeleton key={i} />
      ))}
    </>
  );
}

export function SshDetailsSkeleton() {
  return (
    <>
      <div className="skeleton-ssh-grid">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton-status-item">
            <div className="skeleton skeleton-text" style={{ width: '40%', height: '10px' }} />
            <div className="skeleton skeleton-text" style={{ width: '70%' }} />
          </div>
        ))}
      </div>
      <div className="skeleton-config-section">
        <div className="skeleton skeleton-text" style={{ width: 140, height: 12, marginBottom: 10 }} />
        <div className="skeleton-config-chips">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" style={{ width: 100, height: 26, borderRadius: 9999 }} />
          ))}
        </div>
      </div>
    </>
  );
}
