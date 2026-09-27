import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js";
import { useEffect, useRef, useState } from "react";

const Plot = createPlotlyComponent(Plotly);

export default function PlotlyFigure({ onInitialized, onPurge, ...props }) {
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    let frame;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry.contentRect.width || !entry.contentRect.height) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (graphRef.current)
          Plotly.Plots.resize(graphRef.current).catch(() => {});
      });
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minWidth: 0 }}
    >
      {failed ? (
        <div className="canvas-empty" role="alert">
          <strong>This plot could not be displayed</strong>
          <button
            type="button"
            className="button button--outline"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            Reload plot
          </button>
        </div>
      ) : (
        <Plot
          {...props}
          key={attempt}
          onInitialized={(figure, graph) => {
            graphRef.current = graph;
            onInitialized?.(figure, graph);
          }}
          onPurge={(figure, graph) => {
            graphRef.current = null;
            onPurge?.(figure, graph);
          }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
