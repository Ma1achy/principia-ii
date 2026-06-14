"""
Generate remaining diagrams for the Principia spec:
1. Free-group word encoding
2. Tile lifecycle state machine
3. Frequency diffusion two-window
4. Escape detection persistence
5. Shape sphere trajectory examples
6. Ensemble sampling schematic
7. Symmetry reduction cascade
8. Hyperspherical Jacobi parameterisation
9. Feasibility parabola (Lz, E)
10. Mass simplex
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle, Arc, Wedge
from matplotlib.collections import LineCollection
import matplotlib.patheffects as pe
import os

OUT = "/home/claude"
DPI = 200

def _box(ax, x, y, w, h, text, color='#e8e8e8', edgecolor='#333',
         fontsize=9, bold=False, textcolor='#111'):
    box = FancyBboxPatch((x - w/2, y - h/2), w, h,
                         boxstyle="round,pad=0.08", facecolor=color,
                         edgecolor=edgecolor, linewidth=1.5)
    ax.add_patch(box)
    weight = 'bold' if bold else 'normal'
    ax.text(x, y, text, ha='center', va='center', fontsize=fontsize,
            fontweight=weight, color=textcolor)

def _arrow(ax, x1, y1, x2, y2, label='', color='#555', lw=1.5, fontsize=7,
           label_offset_y=0.15):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', color=color, lw=lw))
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx, my + label_offset_y, label, ha='center', va='bottom',
                fontsize=fontsize, color=color, style='italic')


# ============================================================
# 1. FREE-GROUP WORD ENCODING
# ============================================================
def gen_freegroup_word():
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.5))
    
    # Left: shape sphere with trajectory and branch cuts
    ax = axes[0]
    ax.set_xlim(-1.5, 1.5)
    ax.set_ylim(-1.5, 1.5)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('Trajectory on S² crossing branch cuts', fontsize=9, fontweight='bold')
    
    # Draw equator circle
    theta = np.linspace(0, 2*np.pi, 200)
    ax.plot(np.cos(theta), np.sin(theta), '-', color='#cccccc', lw=1)
    
    # BC points (projected from 3D to 2D - equirectangular-ish)
    bc = np.array([[1, 0], [-0.5, np.sqrt(3)/2], [-0.5, -np.sqrt(3)/2]])
    bc_labels = ['$\\hat{b}_1$', '$\\hat{b}_2$', '$\\hat{b}_3$']
    for i, (p, label) in enumerate(zip(bc, bc_labels)):
        ax.plot(p[0], p[1], 'o', markersize=10, color='red', markeredgecolor='darkred', lw=1.2, zorder=10)
        offset = p * 1.18
        ax.text(offset[0], offset[1], label, fontsize=10, ha='center', va='center',
                color='darkred', fontweight='bold')
    
    # North pole (Lagrange)
    ax.plot(0, 0, '^', markersize=8, color='#00aa44', markeredgecolor='#005522', zorder=10)
    ax.text(0.12, 0.1, '$\\hat{l}^+$', fontsize=9, color='#005522', fontweight='bold')
    
    # Branch cuts: b1 to pole, b2 to pole
    for i in range(2):
        t = np.linspace(0, 0.85, 30)
        px = bc[i, 0] * (1 - t)
        py = bc[i, 1] * (1 - t)
        ax.plot(px, py, '--', color='purple', lw=2, alpha=0.7, zorder=5)
    ax.text(0.55, -0.08, '$C_a$', fontsize=9, color='purple', fontweight='bold')
    ax.text(-0.18, 0.35, '$C_b$', fontsize=9, color='purple', fontweight='bold')
    
    # Trajectory: a spiral-ish path crossing the cuts
    t = np.linspace(0, 4*np.pi, 500)
    r = 0.6 + 0.25*np.sin(t*0.7)
    traj_x = r * np.cos(t * 0.4 + 0.5)
    traj_y = r * np.sin(t * 0.4 + 0.5)
    
    # Color gradient along trajectory
    points = np.array([traj_x, traj_y]).T.reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)
    colors = plt.cm.viridis(np.linspace(0, 1, len(segments)))
    lc = LineCollection(segments, colors=colors, linewidths=1.5, zorder=3)
    ax.add_collection(lc)
    
    # Start/end markers
    ax.plot(traj_x[0], traj_y[0], 'o', color='#228833', markersize=6, zorder=11)
    ax.text(traj_x[0]+0.08, traj_y[0]+0.08, 'start', fontsize=7, color='#228833')
    ax.plot(traj_x[-1], traj_y[-1], 's', color='#cc4444', markersize=6, zorder=11)
    
    # Crossing annotations
    ax.annotate('cross $C_a$ →', xy=(0.45, 0.15), fontsize=7, color='purple',
                fontweight='bold', ha='center')
    ax.annotate('cross $C_b$ ←', xy=(-0.25, 0.55), fontsize=7, color='purple',
                fontweight='bold', ha='center')
    
    # Right: bit packing diagram
    ax2 = axes[1]
    ax2.set_xlim(-0.5, 8)
    ax2.set_ylim(-1.5, 5)
    ax2.axis('off')
    ax2.set_title('Free-group word encoding', fontsize=9, fontweight='bold')
    
    # Symbol table
    symbols = [
        ('a', '0b00', 'Loop around $\\hat{b}_1$ (anticlockwise)'),
        ('A = $a^{-1}$', '0b01', 'Loop around $\\hat{b}_1$ (clockwise)'),
        ('b', '0b10', 'Loop around $\\hat{b}_2$ (anticlockwise)'),
        ('B = $b^{-1}$', '0b11', 'Loop around $\\hat{b}_2$ (clockwise)'),
    ]
    
    y = 4.2
    ax2.text(0, y + 0.4, 'Symbol', fontsize=8, fontweight='bold')
    ax2.text(1.6, y + 0.4, 'Code', fontsize=8, fontweight='bold')
    ax2.text(3.0, y + 0.4, 'Meaning', fontsize=8, fontweight='bold')
    
    for sym, code, meaning in symbols:
        ax2.text(0.2, y, sym, fontsize=9, fontweight='bold', color='#333',
                fontfamily='monospace')
        ax2.text(1.6, y, code, fontsize=8, fontfamily='monospace', color='#555')
        ax2.text(3.0, y, meaning, fontsize=7, color='#333')
        y -= 0.55
    
    # Example word
    y -= 0.5
    ax2.text(0, y, 'Example:', fontsize=8, fontweight='bold')
    ax2.text(1.5, y, 'a b B a  →  a a  (free reduction: bB cancels)',
             fontsize=7.5, fontfamily='monospace', color='#2266aa')
    
    # Bit packing
    y -= 1.0
    ax2.text(0, y + 0.4, 'uint4 bit packing (58 symbols max):', fontsize=8, fontweight='bold')
    
    # Draw 4 uint32 boxes
    box_w = 1.6
    for i, label in enumerate(['.x (sym 0–15)', '.y (sym 16–31)', '.z (sym 32–47)', '.w (48–57 + len)']):
        bx = i * (box_w + 0.2) + 0.2
        rect = plt.Rectangle((bx, y - 0.3), box_w, 0.4,
                             facecolor=['#c4d9f0', '#d4edda', '#fff3cd', '#e8d4ed'][i],
                             edgecolor='#555', lw=0.8)
        ax2.add_patch(rect)
        ax2.text(bx + box_w/2, y - 0.1, label, ha='center', va='center', fontsize=5.5)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'freegroup_word.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> freegroup_word.png")


# ============================================================
# 2. TILE LIFECYCLE STATE MACHINE
# ============================================================
def gen_tile_lifecycle():
    fig, ax = plt.subplots(1, 1, figsize=(9, 4.5))
    ax.set_xlim(-0.5, 9.5)
    ax.set_ylim(-0.5, 4.5)
    ax.axis('off')
    ax.set_title('Tile Lifecycle State Machine', fontsize=12, fontweight='bold', pad=12)
    
    states = {
        'Unseen':         (0.8,  2.2, '#e8e8e8'),
        'Queued':         (2.8,  2.2, '#fff3cd'),
        'Computing':      (4.8,  2.2, '#ffeeba'),
        'Ready':          (6.8,  2.2, '#d4edda'),
        'ReadyRefinable': (6.8,  0.5, '#b8d4a8'),
        'Evicted':        (2.8,  0.5, '#fde8e8'),
    }
    
    for name, (x, y, color) in states.items():
        _box(ax, x, y, 1.6, 0.65, name, color, fontsize=8, bold=True)
    
    # Transitions
    transitions = [
        ('Unseen', 'Queued', 'scheduler\nqueues', 0),
        ('Queued', 'Computing', 'GPU\ndispatched', 0),
        ('Computing', 'Ready', 'reduction\ncomplete', 0),
        ('Ready', 'ReadyRefinable', 'reduction says\n"interesting"', 0),
        ('ReadyRefinable', 'Queued', 'children\nqueued', 0),
        ('Ready', 'Evicted', 'cache\npressure', -0.3),
        ('Evicted', 'Queued', 're-enters\nviewport', 0),
    ]
    
    for src, dst, label, curve in transitions:
        sx, sy, _ = states[src]
        dx, dy, _ = states[dst]
        
        # Determine arrow start/end points on box edges
        if abs(sx - dx) > abs(sy - dy):
            # Horizontal-dominant
            if dx > sx:
                x1, x2 = sx + 0.85, dx - 0.85
            else:
                x1, x2 = sx - 0.85, dx + 0.85
            y1, y2 = sy, dy
        else:
            # Vertical-dominant
            x1, x2 = sx, dx
            if dy > sy:
                y1, y2 = sy + 0.35, dy - 0.35
            else:
                y1, y2 = sy - 0.35, dy + 0.35
        
        if src == 'Ready' and dst == 'Evicted':
            # Curved arrow going below
            style = "arc3,rad=0.3"
            ax.annotate('', xy=(dx + 0.85, dy + 0.3), xytext=(sx - 0.85, sy - 0.35),
                        arrowprops=dict(arrowstyle='->', color='#aa3333', lw=1.2,
                                       connectionstyle=style))
            ax.text(4.8, 0.85, label, fontsize=6, color='#aa3333', ha='center',
                    style='italic')
        elif src == 'Evicted' and dst == 'Queued':
            ax.annotate('', xy=(dx - 0.3, dy - 0.35), xytext=(sx + 0.3, sy + 0.35),
                        arrowprops=dict(arrowstyle='->', color='#666', lw=1.2))
            ax.text(2.8, 1.45, label, fontsize=6, color='#666', ha='center', style='italic')
        elif src == 'ReadyRefinable' and dst == 'Queued':
            ax.annotate('', xy=(dx + 0.2, dy - 0.35), xytext=(sx - 0.85, sy),
                        arrowprops=dict(arrowstyle='->', color='#228833', lw=1.2,
                                       connectionstyle="arc3,rad=-0.3"))
            ax.text(4.5, -0.1, label, fontsize=6, color='#228833', ha='center', style='italic')
        else:
            ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                        arrowprops=dict(arrowstyle='->', color='#555', lw=1.2))
            mx, my = (x1+x2)/2, (y1+y2)/2
            ax.text(mx, my + 0.25, label, fontsize=6, color='#555', ha='center', style='italic')
    
    # Stale annotation
    ax.text(8.5, 3.8, 'View change\ninvalidates →\nrequeue', fontsize=6.5,
            color='#888', style='italic', ha='center',
            bbox=dict(boxstyle='round,pad=0.2', facecolor='#f8f8f8', edgecolor='#ccc'))
    
    fig.savefig(os.path.join(OUT, 'tile_lifecycle.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> tile_lifecycle.png")


# ============================================================
# 3. FREQUENCY DIFFUSION TWO-WINDOW
# ============================================================
def gen_freq_diffusion():
    fig, ax = plt.subplots(1, 1, figsize=(7, 3.5))
    
    t = np.linspace(0, 100, 1000)
    # Unwrapped phase with slight frequency change
    omega1 = 0.5
    omega2 = 0.62
    phase = np.where(t < 50, omega1 * t, omega1 * 50 + omega2 * (t - 50))
    phase += 0.8 * np.sin(0.3 * t)  # quasiperiodic wobble
    
    ax.plot(t, phase, '-', color='#2266aa', lw=1.5, label='$\\tilde{\\theta}(t)$')
    
    # Windows
    T = 100
    w1_start, w1_end = T/4, T/2
    w2_start, w2_end = T/2, 3*T/4
    
    ax.axvspan(w1_start, w1_end, alpha=0.15, color='#cc4444', label='$W_1$')
    ax.axvspan(w2_start, w2_end, alpha=0.15, color='#228833', label='$W_2$')
    
    # Linear fits in each window
    mask1 = (t >= w1_start) & (t <= w1_end)
    mask2 = (t >= w2_start) & (t <= w2_end)
    
    t1, p1 = t[mask1], phase[mask1]
    fit1 = np.polyfit(t1, p1, 1)
    ax.plot(t1, np.polyval(fit1, t1), '--', color='#cc4444', lw=2,
            label=f'$\\omega_1 = {fit1[0]:.2f}$')
    
    t2, p2 = t[mask2], phase[mask2]
    fit2 = np.polyfit(t2, p2, 1)
    ax.plot(t2, np.polyval(fit2, t2), '--', color='#228833', lw=2,
            label=f'$\\omega_2 = {fit2[0]:.2f}$')
    
    # Diffusion annotation
    D = abs(fit2[0] - fit1[0])
    ax.text(62, 18, f'$D = |\\omega_2 - \\omega_1| = {D:.2f}$',
            fontsize=10, fontweight='bold', color='#333',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#fff3cd', edgecolor='#888'))
    
    ax.set_xlabel('Integration time $t$', fontsize=9)
    ax.set_ylabel('Unwrapped phase $\\tilde{\\theta}(t)$', fontsize=9)
    ax.set_title('Frequency Diffusion: Two-Window Scheme', fontsize=11, fontweight='bold')
    ax.legend(fontsize=7.5, loc='upper left')
    ax.grid(True, alpha=0.3)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'freq_diffusion.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> freq_diffusion.png")


# ============================================================
# 4. ESCAPE DETECTION PERSISTENCE
# ============================================================
def gen_escape_persistence():
    fig, axes = plt.subplots(2, 1, figsize=(8, 4), gridspec_kw={'height_ratios': [1.2, 1]},
                            sharex=True)
    
    t = np.arange(0, 60)
    np.random.seed(42)
    
    # Simulate three gates
    dist_gate = np.array([0]*15 + [1]*5 + [0]*3 + [1]*37)
    outward_gate = np.array([0]*15 + [1]*4 + [0]*1 + [1]*1 + [0]*2 + [1]*37)
    energy_gate = np.array([0]*15 + [1]*3 + [0]*2 + [1]*2 + [0]*1 + [1]*37)
    
    all_gates = dist_gate & outward_gate & energy_gate
    
    # Counter with linear persistence/decay
    k_esc = 8
    counter = np.zeros(len(t), dtype=int)
    for i in range(1, len(t)):
        if all_gates[i]:
            counter[i] = min(counter[i-1] + 1, k_esc)
        else:
            counter[i] = max(counter[i-1] - 1, 0)
    
    # Top: gates
    ax = axes[0]
    ax.set_title('Escape Detection: Three-Gate Persistence Counter', fontsize=10, fontweight='bold')
    
    colors = ['#2266aa', '#228833', '#cc8800']
    labels = ['Distance: $\\|\\lambda\\| > R_{esc}$',
              'Outward: $\\lambda \\cdot v_\\lambda > 0$',
              'Energy: $E_{out} > 0$']
    
    for i, (gate, color, label) in enumerate(zip([dist_gate, outward_gate, energy_gate],
                                                  colors, labels)):
        offset = i * 1.3
        ax.fill_between(t, offset, offset + gate * 0.9, alpha=0.4, color=color,
                        step='mid', label=label)
        ax.plot(t, offset + gate * 0.9, drawstyle='steps-mid', color=color, lw=0.8)
    
    ax.set_yticks([0.45, 1.75, 3.05])
    ax.set_yticklabels(['Distance', 'Outward', 'Energy'], fontsize=7)
    ax.set_ylim(-0.2, 4.0)
    ax.legend(fontsize=6.5, loc='upper left', ncol=1)
    ax.grid(True, alpha=0.2, axis='x')
    
    # Bottom: counter
    ax2 = axes[1]
    ax2.fill_between(t, counter, alpha=0.3, color='#cc4444', step='mid')
    ax2.plot(t, counter, drawstyle='steps-mid', color='#cc4444', lw=1.5)
    ax2.axhline(k_esc, color='#cc4444', ls='--', lw=1.5, label=f'$k_{{esc}} = {k_esc}$ (threshold)')
    
    # Find escape time
    escape_idx = np.argmax(counter >= k_esc)
    if counter[escape_idx] >= k_esc:
        ax2.axvline(t[escape_idx], color='#aa0000', ls=':', lw=2, alpha=0.7)
        ax2.text(t[escape_idx] + 0.5, k_esc/2, 'ESCAPE\nDECLARED',
                fontsize=8, fontweight='bold', color='#aa0000')
    
    ax2.set_xlabel('Integration step', fontsize=9)
    ax2.set_ylabel('Counter $c_{esc}$', fontsize=9)
    ax2.legend(fontsize=7.5)
    ax2.set_ylim(-0.5, k_esc + 1.5)
    ax2.grid(True, alpha=0.2)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'escape_persistence.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> escape_persistence.png")


# ============================================================
# 5. SHAPE SPHERE TRAJECTORY EXAMPLES
# ============================================================
def gen_shape_trajectories():
    fig, axes = plt.subplots(1, 2, figsize=(8, 4), subplot_kw={'projection': '3d'})
    
    for ax_idx, ax in enumerate(axes):
        # Sphere wireframe
        u = np.linspace(0, 2*np.pi, 30)
        v = np.linspace(0, np.pi, 15)
        x = np.outer(np.cos(u), np.sin(v))
        y = np.outer(np.sin(u), np.sin(v))
        z = np.outer(np.ones_like(u), np.cos(v))
        ax.plot_surface(x, y, z, alpha=0.06, color='#aaccee', edgecolor='#dddddd', linewidth=0.2)
        
        # BC points
        bc = np.array([[1, 0, 0], [-0.5, np.sqrt(3)/2, 0], [-0.5, -np.sqrt(3)/2, 0]])
        for p in bc:
            ax.scatter(*p, s=40, c='red', zorder=10)
        
        # Lagrange poles
        ax.scatter(0, 0, 1, s=30, c='#00aa44', marker='^', zorder=10)
        ax.scatter(0, 0, -1, s=30, c='#00aa44', marker='v', zorder=10)
        
        if ax_idx == 0:
            # Regular trajectory: smooth loop
            t = np.linspace(0, 2*np.pi, 300)
            theta = 0.4 + 0.2 * np.sin(t)
            phi = t * 1.3 + 0.3 * np.sin(2*t)
            tx = np.sin(theta) * np.cos(phi)
            ty = np.sin(theta) * np.sin(phi)
            tz = np.cos(theta)
            ax.plot(tx, ty, tz, '-', color='#2266aa', lw=1.8, zorder=5)
            ax.set_title('Regular / quasiperiodic\nWord: ab', fontsize=9, fontweight='bold')
        else:
            # Chaotic trajectory: tangled path
            np.random.seed(7)
            t = np.linspace(0, 10*np.pi, 2000)
            theta = np.pi/2 + 0.8 * np.sin(t * 0.7) * np.cos(t * 0.3 + np.cumsum(np.random.randn(len(t))*0.01))
            phi = t * 0.8 + 1.5 * np.sin(t * 0.5) + 0.5 * np.sin(t * 1.3)
            theta = np.clip(theta, 0.15, np.pi - 0.15)
            tx = np.sin(theta) * np.cos(phi)
            ty = np.sin(theta) * np.sin(phi)
            tz = np.cos(theta)
            ax.plot(tx, ty, tz, '-', color='#cc4444', lw=0.5, alpha=0.7, zorder=5)
            ax.set_title('Chaotic scattering\nWord: aAbBaabBA...', fontsize=9, fontweight='bold')
        
        ax.set_xlim([-1.2, 1.2])
        ax.set_ylim([-1.2, 1.2])
        ax.set_zlim([-1.2, 1.2])
        ax.set_box_aspect([1, 1, 1])
        ax.axis('off')
        ax.view_init(elev=20, azim=40)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'shape_trajectories.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> shape_trajectories.png")


# ============================================================
# 6. ENSEMBLE SAMPLING SCHEMATIC
# ============================================================
def gen_ensemble_sampling():
    fig, ax = plt.subplots(1, 1, figsize=(6, 4.5))
    ax.set_xlim(-0.3, 5.5)
    ax.set_ylim(-0.5, 4.5)
    ax.axis('off')
    ax.set_title('Ensemble Spread: Finite Pixel Footprint', fontsize=11, fontweight='bold', pad=10)
    
    # Pixel footprint
    cx, cy = 1.2, 2.5
    r = 0.45
    circle = Circle((cx, cy), r, facecolor='#e8e8ff', edgecolor='#2266aa', lw=2, ls='--')
    ax.add_patch(circle)
    ax.text(cx, cy - 0.65, 'pixel footprint\n(IC-space radius $r$)', ha='center',
            fontsize=7, color='#2266aa', style='italic')
    
    # Base point
    ax.plot(cx, cy, 'ko', markersize=6, zorder=10)
    ax.text(cx + 0.08, cy + 0.08, '$x_0$', fontsize=9, fontweight='bold')
    
    # Jittered copies
    np.random.seed(12)
    E = 6
    angles = np.linspace(0, 2*np.pi, E, endpoint=False) + 0.3
    offsets = r * 0.7
    jitter_pts = [(cx + offsets*np.cos(a), cy + offsets*np.sin(a)) for a in angles]
    
    outcomes = ['Escape 1-2', 'Escape 1-2', 'Escape 2-3', 'Escape 1-2', 'Escape 2-3', 'Escape 1-2']
    colors_out = ['#2266aa', '#2266aa', '#cc4444', '#2266aa', '#cc4444', '#2266aa']
    
    for i, ((jx, jy), outcome, col) in enumerate(zip(jitter_pts, outcomes, colors_out)):
        ax.plot(jx, jy, 'o', markersize=4, color=col, zorder=10)
        
        # Trajectory arrows diverging to outcomes
        end_x = 4.0 + (0.3 if col == '#2266aa' else -0.3)
        end_y = 3.5 - i * 0.5 + (0.1 if col == '#cc4444' else 0)
        ax.annotate('', xy=(end_x, end_y), xytext=(jx + 0.05, jy),
                    arrowprops=dict(arrowstyle='->', color=col, lw=0.7, alpha=0.5,
                                   connectionstyle='arc3,rad=0.1'))
    
    # Outcome boxes
    _box(ax, 4.5, 3.2, 1.2, 0.5, 'Escape 1-2\n(4/6)', '#c4d9f0', fontsize=7.5, bold=True)
    _box(ax, 4.5, 1.8, 1.2, 0.5, 'Escape 2-3\n(2/6)', '#fde8e8', fontsize=7.5, bold=True)
    
    # Agreement annotation
    ax.text(2.7, 0.3, 'Ensemble agreement = 4/6 = 0.67\n→ pixel straddles a basin boundary',
            fontsize=8, ha='center', fontweight='bold', color='#333',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#fff3cd', edgecolor='#888'))
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'ensemble_sampling.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> ensemble_sampling.png")


# ============================================================
# 7. SYMMETRY REDUCTION CASCADE
# ============================================================
def gen_symmetry_cascade():
    fig, axes = plt.subplots(1, 5, figsize=(11, 2.8))
    fig.suptitle('Symmetry Reduction: 12 DOF → 5 DOF (planar, 3 bodies)',
                 fontsize=10, fontweight='bold', y=1.02)
    
    titles = ['Physical config\n12 DOF', 'COM frame\n−4 DOF → 8',
              'Rotate ρ̃ to +x\n−1 DOF → 7', 'Mirror λ̃_y ≥ 0\n−1 DOF → 6',
              'Scale I = 1\n−1 DOF → 5']
    
    for idx, ax in enumerate(axes):
        ax.set_xlim(-1.5, 1.5)
        ax.set_ylim(-1.5, 1.5)
        ax.set_aspect('equal')
        ax.axis('off')
        ax.set_title(titles[idx], fontsize=7, fontweight='bold')
        
        if idx == 0:
            # Arbitrary triangle, arbitrary position
            pts = np.array([[0.3, 0.5], [-0.7, -0.3], [0.8, -0.6]])
            com = np.mean(pts, axis=0)
        elif idx == 1:
            # Centred on COM
            pts = np.array([[0.5, 0.4], [-0.8, -0.2], [0.3, -0.5]])
            com = np.mean(pts, axis=0)
            pts -= com
            com = np.array([0, 0])
            ax.plot(0, 0, '+', color='#888', markersize=8, markeredgewidth=1.5)
        elif idx == 2:
            # ρ along +x
            pts = np.array([[0.5, 0], [-0.5, 0], [-0.1, 0.7]])
            com = np.array([0, 0])
            ax.plot(0, 0, '+', color='#888', markersize=8, markeredgewidth=1.5)
            ax.annotate('', xy=(0.6, 0), xytext=(-0.6, 0),
                        arrowprops=dict(arrowstyle='->', color='#cc4444', lw=1.5))
            ax.text(0, -0.15, '$\\tilde{ρ}$', fontsize=8, color='#cc4444',
                    ha='center', fontweight='bold')
        elif idx == 3:
            # λ_y ≥ 0
            pts = np.array([[0.5, 0], [-0.5, 0], [-0.1, 0.7]])
            com = np.array([0, 0])
            ax.plot(0, 0, '+', color='#888', markersize=8, markeredgewidth=1.5)
            ax.axhline(0, color='#aaa', lw=0.5, ls=':')
            ax.text(1.0, 0.1, '$\\tilde{λ}_y ≥ 0$', fontsize=7, color='#228833')
            ax.fill_between([-1.5, 1.5], [0, 0], [1.5, 1.5], alpha=0.05, color='#228833')
        elif idx == 4:
            # Scaled to I=1
            pts = np.array([[0.45, 0], [-0.45, 0], [-0.09, 0.63]])
            com = np.array([0, 0])
            ax.plot(0, 0, '+', color='#888', markersize=8, markeredgewidth=1.5)
            theta_c = np.linspace(0, 2*np.pi, 100)
            I = np.sqrt(np.sum(pts**2))
            ax.plot(0.7*np.cos(theta_c), 0.7*np.sin(theta_c), ':', color='#666', lw=0.8)
            ax.text(0.75, 0.75, '$I=1$', fontsize=7, color='#666')
        
        # Draw triangle
        tri = np.vstack([pts, pts[0]])
        ax.plot(tri[:, 0], tri[:, 1], '-', color='#333', lw=1.2)
        ax.fill(pts[:, 0], pts[:, 1], alpha=0.1, color='#4488cc')
        
        # Mass dots
        sizes = [8, 6, 5]
        colors_m = ['#cc4444', '#2266aa', '#228833']
        for i, (p, s, c) in enumerate(zip(pts, sizes, colors_m)):
            ax.plot(p[0], p[1], 'o', markersize=s, color=c, markeredgecolor='#333', lw=0.5)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'symmetry_cascade.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> symmetry_cascade.png")


# ============================================================
# 8. HYPERSPHERICAL JACOBI
# ============================================================
def gen_hyperspherical_jacobi():
    fig, ax = plt.subplots(1, 1, figsize=(5.5, 4.5))
    ax.set_xlim(-0.8, 2.5)
    ax.set_ylim(-0.5, 2.2)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('Hyperspherical Mass-Weighted Jacobi Coordinates',
                 fontsize=10, fontweight='bold', pad=10)
    
    # Draw ρ̃ along x-axis
    R = 1.5  # total radius (I=1 means |ρ̃|² + |λ̃|² = 1)
    alpha = 0.65  # α angle
    
    rho_mag = R * np.cos(alpha)
    lam_mag = R * np.sin(alpha)
    beta = 0.7  # β angle
    
    # ρ̃ vector (along +x by canonical frame)
    rho_end = np.array([rho_mag, 0])
    ax.annotate('', xy=rho_end, xytext=[0, 0],
                arrowprops=dict(arrowstyle='->', color='#cc4444', lw=2.5))
    ax.text(rho_mag/2, -0.18, '$\\tilde{ρ} = \\tilde{R}\\cos α$', fontsize=9,
            ha='center', color='#cc4444', fontweight='bold')
    
    # λ̃ vector at angle β from x-axis
    lam_end = np.array([lam_mag * np.cos(beta), lam_mag * np.sin(beta)])
    ax.annotate('', xy=lam_end, xytext=[0, 0],
                arrowprops=dict(arrowstyle='->', color='#2266aa', lw=2.5))
    ax.text(lam_end[0] - 0.3, lam_end[1] + 0.08, '$\\tilde{λ} = \\tilde{R}\\sin α$',
            fontsize=9, color='#2266aa', fontweight='bold')
    
    # α arc (from ρ̃ to the "total radius" direction)
    theta_arc = np.linspace(0, alpha, 30)
    r_arc = 0.5
    ax.plot(r_arc * np.cos(theta_arc), r_arc * np.sin(theta_arc), '-', color='#888', lw=1.2)
    ax.text(0.55, 0.2, '$α$', fontsize=11, color='#888', fontweight='bold')
    
    # β arc (angle of λ̃ from x-axis)
    beta_arc = np.linspace(0, beta, 30)
    r_beta = 0.35
    ax.plot(r_beta * np.cos(beta_arc), r_beta * np.sin(beta_arc), '-', color='#228833', lw=1.2)
    ax.text(0.3, 0.15, '$β$', fontsize=10, color='#228833', fontweight='bold')
    
    # Annotations
    ax.text(2.0, 1.5, '$α ≈ 0$: tight inner pair\n$α ≈ π/2$: comparable scales',
            fontsize=7.5, color='#666',
            bbox=dict(boxstyle='round,pad=0.25', facecolor='#f8f8f8', edgecolor='#ccc'))
    ax.text(2.0, 0.7, '$β ∈ [0, π]$: angle between\nJacobi vectors\n(mirror: $β ≥ 0$)',
            fontsize=7.5, color='#666',
            bbox=dict(boxstyle='round,pad=0.25', facecolor='#f8f8f8', edgecolor='#ccc'))
    
    # Scale gauge annotation
    ax.text(2.0, 0.0, '$\\tilde{R} = 1$ (scale gauge)\n$I = |\\tilde{ρ}|^2 + |\\tilde{λ}|^2 = 1$',
            fontsize=7.5, color='#666',
            bbox=dict(boxstyle='round,pad=0.25', facecolor='#fff3cd', edgecolor='#ccc'))
    
    # Origin
    ax.plot(0, 0, 'ko', markersize=4, zorder=10)
    ax.text(-0.08, -0.12, 'COM', fontsize=7, ha='center')
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'hyperspherical_jacobi.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> hyperspherical_jacobi.png")


# ============================================================
# 9. FEASIBILITY PARABOLA (Lz, E)
# ============================================================
def gen_feasibility_parabola():
    fig, ax = plt.subplots(1, 1, figsize=(5.5, 4.5))
    
    # Parabolic boundary: |Lz| <= sqrt(2*I*(E - U))
    # With I=1, this is Lz^2 <= 2*(E - U), so E >= U + Lz^2 / 2
    U = -2.0  # typical potential for normalised three-body
    
    Lz = np.linspace(-3, 3, 300)
    E_boundary = U + Lz**2 / 2
    
    # Fill feasible region
    E_max = 3.0
    ax.fill_between(Lz, E_boundary, E_max, alpha=0.12, color='#228833',
                    label='Feasible region')
    ax.plot(Lz, E_boundary, '-', color='#228833', lw=2,
            label='$|L_z| = \\sqrt{2I(E-U)}$')
    
    # Infeasible region
    ax.fill_between(Lz, -3, E_boundary, alpha=0.08, color='#cc4444')
    ax.text(0, -2.5, 'Infeasible\n($K < 0$)', ha='center', fontsize=8,
            color='#cc4444', style='italic')
    
    # Rest start point
    ax.plot(0, U, 'o', markersize=10, color='#cc4444', markeredgecolor='#882222',
            zorder=10, lw=1.5)
    ax.text(0.15, U - 0.25, 'Rest start\n$(0, U)$', fontsize=8, color='#882222',
            fontweight='bold')
    
    # UV mapping arrows
    ax.annotate('', xy=(2.5, 2.5), xytext=(0.1, U + 0.1),
                arrowprops=dict(arrowstyle='->', color='#2266aa', lw=1.5, ls='--',
                               connectionstyle='arc3,rad=0.2'))
    ax.text(1.8, 1.5, 'Domain warp\n$[0,1]^2 \\to$ feasible', fontsize=7.5,
            color='#2266aa', fontweight='bold', style='italic')
    
    # E = 0 line
    ax.axhline(0, color='#888', ls=':', lw=1)
    ax.text(-2.8, 0.15, '$E = 0$ (unbound boundary)', fontsize=7, color='#888')
    
    ax.set_xlabel('$L_z$ (angular momentum)', fontsize=9)
    ax.set_ylabel('$E$ (total energy)', fontsize=9)
    ax.set_title('$(L_z, E)$ Feasibility Region', fontsize=11, fontweight='bold')
    ax.set_xlim(-3.2, 3.2)
    ax.set_ylim(-3.2, 3.5)
    ax.legend(fontsize=7.5, loc='upper left')
    ax.grid(True, alpha=0.2)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'feasibility_parabola.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> feasibility_parabola.png")


# ============================================================
# 10. MASS SIMPLEX
# ============================================================
def gen_mass_simplex():
    fig, ax = plt.subplots(1, 1, figsize=(5, 4.5))
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('Mass Simplex $\\Delta_2$', fontsize=11, fontweight='bold', pad=10)
    
    # Equilateral triangle for the simplex
    h = np.sqrt(3) / 2
    verts = np.array([[0, 0], [1, 0], [0.5, h]])
    tri = np.vstack([verts, verts[0]])
    ax.plot(tri[:, 0], tri[:, 1], '-', color='#333', lw=2)
    ax.fill(verts[:, 0], verts[:, 1], alpha=0.08, color='#4488cc')
    
    # Interior buffer
    eps = 0.06
    bary = np.mean(verts, axis=0)
    inner_verts = (1 - 3*eps) * verts + 3*eps * bary
    inner_tri = np.vstack([inner_verts, inner_verts[0]])
    ax.plot(inner_tri[:, 0], inner_tri[:, 1], '--', color='#888', lw=1)
    ax.text(0.75, 0.05, '$\\varepsilon_m$ buffer', fontsize=7, color='#888', style='italic')
    
    # Vertex labels
    ax.text(-0.08, -0.06, '$m_1 = 1$', fontsize=8, fontweight='bold', ha='center')
    ax.text(1.08, -0.06, '$m_2 = 1$', fontsize=8, fontweight='bold', ha='center')
    ax.text(0.5, h + 0.06, '$m_3 = 1$', fontsize=8, fontweight='bold', ha='center')
    
    # Equal mass point (barycentre)
    ax.plot(bary[0], bary[1], 'o', markersize=8, color='#228833',
            markeredgecolor='#115511', zorder=10, lw=1.5)
    ax.text(bary[0] + 0.08, bary[1] + 0.05, 'Equal mass\n$(⅓, ⅓, ⅓)$',
            fontsize=7.5, color='#228833', fontweight='bold')
    
    # Burrau point for 3-4-5
    a, b, c = 3, 4, 5
    m1_b = c / (a + b + c)  # 5/12
    m2_b = b / (a + b + c)  # 4/12
    m3_b = a / (a + b + c)  # 3/12
    # Barycentric to Cartesian
    burrau_pt = m1_b * verts[0] + m2_b * verts[1] + m3_b * verts[2]
    ax.plot(burrau_pt[0], burrau_pt[1], 's', markersize=8, color='#cc4444',
            markeredgecolor='#882222', zorder=10, lw=1.5)
    ax.text(burrau_pt[0] - 0.15, burrau_pt[1] - 0.07,
            f'Burrau (3,4,5)\n$({c},{b},{a})/{a+b+c}$',
            fontsize=7, color='#cc4444', fontweight='bold', ha='center', va='top')
    
    # Another Burrau point: 5-12-13
    a2, b2, c2 = 5, 12, 13
    m1_b2 = c2 / (a2 + b2 + c2)
    m2_b2 = b2 / (a2 + b2 + c2)
    m3_b2 = a2 / (a2 + b2 + c2)
    bp2 = m1_b2 * verts[0] + m2_b2 * verts[1] + m3_b2 * verts[2]
    ax.plot(bp2[0], bp2[1], 's', markersize=6, color='#cc8800',
            markeredgecolor='#885500', zorder=10, lw=1)
    ax.text(bp2[0] + 0.1, bp2[1], '(5,12,13)', fontsize=6.5, color='#cc8800')
    
    # Edge labels
    ax.text(0.5, -0.12, '$m_3 = 0$', fontsize=7, ha='center', color='#666', style='italic')
    ax.text(-0.05, h/2, '$m_2 = 0$', fontsize=7, ha='right', color='#666',
            style='italic', rotation=60)
    ax.text(1.05, h/2, '$m_1 = 0$', fontsize=7, ha='left', color='#666',
            style='italic', rotation=-60)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'mass_simplex.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> mass_simplex.png")


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    print("Generating remaining diagrams...")
    
    print("\n1. Free-group word encoding")
    gen_freegroup_word()
    
    print("\n2. Tile lifecycle state machine")
    gen_tile_lifecycle()
    
    print("\n3. Frequency diffusion")
    gen_freq_diffusion()
    
    print("\n4. Escape persistence")
    gen_escape_persistence()
    
    print("\n5. Shape sphere trajectories")
    gen_shape_trajectories()
    
    print("\n6. Ensemble sampling")
    gen_ensemble_sampling()
    
    print("\n7. Symmetry reduction cascade")
    gen_symmetry_cascade()
    
    print("\n8. Hyperspherical Jacobi")
    gen_hyperspherical_jacobi()
    
    print("\n9. Feasibility parabola")
    gen_feasibility_parabola()
    
    print("\n10. Mass simplex")
    gen_mass_simplex()
    
    print("\nDone.")
