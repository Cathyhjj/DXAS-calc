import math
import streamlit as st
import plotly.graph_objects as go

from dxas_core import BraggCrystal, LaueCrystal

st.set_page_config(page_title="DXASCalc Web", layout="wide")

st.markdown(
    """
<style>
:root {
  --bg-color: #faf8f5;
  --card-bg: #ffffff;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --accent-color: #9478ac;
  --accent-hover: #7c6396;
  --border-color: #e2e8f0;
}

html, body, [class*="css"] {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: var(--text-primary);
}

.stApp {
  background: var(--bg-color);
}

.block-container {
  max-width: 1400px;
  padding-top: 1rem;
}

h1.title {
  font-weight: 700;
  background: linear-gradient(to right, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.2rem;
}

.subtitle {
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1rem 1.2rem;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
}

.metric-label {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.metric-value {
  font-size: 1.25rem;
  font-weight: 600;
}
</style>
""",
    unsafe_allow_html=True,
)

st.markdown('<h1 class="title">DXASCalc Web</h1>', unsafe_allow_html=True)
st.markdown(
    '<div class="subtitle">Dispersive X-ray Absorption Spectroscopy calculator with EasyXASCalc-inspired styling.</div>',
    unsafe_allow_html=True,
)

left, right = st.columns([1, 2], gap="large")

with left:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    calc_type = st.selectbox("Calculation Type", ["Bragg", "Laue"])
    crystal = st.selectbox("Crystal", ["Si", "Ge"])

    colh = st.columns(3)
    h = colh[0].number_input("h", value=1, step=1)
    k = colh[1].number_input("k", value=1, step=1)
    l = colh[2].number_input("l", value=1, step=1)

    energy_kev = st.number_input("Energy (keV)", min_value=0.1, value=8.333, format="%.4f")
    p_m = st.number_input("Source-to-crystal p (m)", min_value=0.01, value=35.0)
    r_m = st.number_input("Bending radius R (m)", min_value=0.01, value=2.0)
    divergence_mrad = st.number_input("Divergence (mrad, full)", min_value=0.001, value=2.0, format="%.3f")
    asym_deg = st.number_input("Asymmetry angle (deg)", value=0.0, format="%.3f")
    condition = st.selectbox("Condition", ["upper", "lower"] if calc_type == "Bragg" else ["lower", "upper"])

    det2crys_m = st.number_input("Detector-to-crystal distance (m)", min_value=0.001, value=1.0)
    pixel_um = st.number_input("Detector pixel size (μm)", min_value=1.0, value=55.0)
    st.markdown('</div>', unsafe_allow_html=True)

params = dict(
    energy_kev=float(energy_kev),
    h=int(h),
    k=int(k),
    l=int(l),
    p_m=float(p_m),
    divergence_rad=float(divergence_mrad) / 1000.0,
    r_m=float(r_m),
    crystal=crystal,
    asymmetry_rad=math.radians(asym_deg),
    condition=condition,
)

calc = BraggCrystal(**params) if calc_type == "Bragg" else LaueCrystal(**params)

theta_deg = math.degrees(calc.theta0)
flat = calc.energy_spread_flat_ev
bent = calc.energy_spread_bent_ev
focus = calc.geometric_focus_m
beam = calc.bragg_size_mm(det2crys_m) if calc_type == "Bragg" else calc.laue_size_mm(det2crys_m)
resolution = calc.detector_resolution_ev_per_px(det2crys_m, pixel_um)

with right:
    c1, c2, c3 = st.columns(3)
    c1.metric("Bragg angle θ₀", f"{theta_deg:.3f}°")
    c2.metric("Flat spread", f"{flat:.2f} eV")
    c3.metric("Bent spread", f"{bent:.2f} eV")

    c4, c5, c6 = st.columns(3)
    c4.metric("Geometric focus", f"{focus:.3f} m")
    c5.metric("Beam size on detector", f"{beam:.3f} mm")
    c6.metric("Detector resolution", f"{resolution:.3f} eV/pixel")

    xs = ["Flat", "Bent", "Detector"]
    ys = [flat, bent, abs(resolution)]
    fig = go.Figure(
        data=[
            go.Bar(
                x=xs,
                y=ys,
                marker_color=["#60a5fa", "#a78bfa", "#9478ac"],
                text=[f"{v:.2f}" for v in ys],
                textposition="outside",
            )
        ]
    )
    fig.update_layout(
        title="Energy Spread / Resolution Summary",
        paper_bgcolor="#ffffff",
        plot_bgcolor="#ffffff",
        font={"color": "#1e293b"},
        xaxis={"gridcolor": "#e2e8f0", "color": "#64748b"},
        yaxis={"gridcolor": "#e2e8f0", "color": "#64748b", "title": "eV"},
        margin={"l": 20, "r": 20, "t": 60, "b": 20},
    )
    st.plotly_chart(fig, use_container_width=True)

st.caption("Built from DXASCalc formulas and styled to match the EasyXASCalc visual language.")
