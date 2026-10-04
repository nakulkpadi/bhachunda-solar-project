import type { RefObject } from "react";
import type { MapFeatureLink } from "./types";

export type LiveMapSelection = { featureKey: string; links: MapFeatureLink[] } | null;

export function FullSurveyMap({
  mapRef,
  isLiveData,
  featureCount,
  selection,
  onLoad,
  onZoomIn,
  onZoomOut,
  onReset,
  onOpenParcel,
  onGoRegistry
}: {
  mapRef: RefObject<HTMLObjectElement | null>;
  isLiveData: boolean;
  featureCount: number;
  selection: LiveMapSelection;
  onLoad: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onOpenParcel: (parcelId: string) => void;
  onGoRegistry: () => void;
}) {
  return <div className="map-layout">
    <section className="card map-intro">
      <div><div className="eyebrow">FULL CAD-DERIVED MAP</div><h2>Survey consent map</h2><p>{isLiveData ? "Map color is driven from live consent records. Green means only consent received; Google Drive files never change the map color." : "Sign in to apply the live consent colors and open matched survey records."}</p></div>
      <button className="button button-secondary" onClick={onGoRegistry} type="button">Open matching register</button>
    </section>
    <section className="map-legend"><span><i className="swatch-green" /> Consent received</span><span><i className="swatch-amber" /> Pending</span><span><i className="swatch-grey" /> Not ready / unconfirmed</span><span><i className="swatch-red" /> Blocked / rejected</span></section>
    <section className="card map-card">
      <div className="map-canvas">
        <object aria-label="Full interactive combined village survey map" className="survey-map" data="./maps/combined-villages-full.svg" onLoad={onLoad} ref={mapRef} type="image/svg+xml"><p>Your browser could not render the survey SVG.</p></object>
        <div className="map-controls" aria-label="Map zoom controls"><button aria-label="Zoom in" onClick={onZoomIn} type="button">+</button><button aria-label="Zoom out" onClick={onZoomOut} type="button">−</button><button className="map-reset" onClick={onReset} type="button">Reset</button></div>
      </div>
    </section>
    <section className="card map-footer">
      <div>
        <strong>{selection ? "CAD feature " + selection.featureKey : "Select a colored survey boundary"}</strong>
        <p>{selection ? selection.links.length === 1 ? "Opening its survey details." : selection.links.length ? "This shape has multiple exact survey matches. Choose the village/survey record below." : "This CAD feature has no exact survey match yet and remains read-only." : "Use + and − to zoom the full map. Click a matched boundary to open the linked survey details."}</p>
        {selection && selection.links.length > 1 && <div className="map-link-list">{selection.links.map((link) => <button key={link.parcel_id} className="button button-secondary" onClick={() => onOpenParcel(link.parcel_id)} type="button">{link.village_name} · Survey {link.survey_number}{link.match_confidence !== "high" ? " (review)" : ""}</button>)}</div>}
      </div>
      <span className="map-proof">{featureCount || "—"} CAD parcel shapes · exact links only</span>
    </section>
  </div>;
}
