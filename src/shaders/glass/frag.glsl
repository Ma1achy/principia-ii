precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_text;
uniform vec2      u_res;
uniform int       u_horizontal;
uniform float     u_blur;

vec3 blurPass(sampler2D tex, vec2 uv, vec2 dir) {
  vec2 px = dir * u_blur / u_res;
  vec3 col = texture2D(tex, uv).rgb                      * 0.1497;
  col     += texture2D(tex, uv + 1.6414 * px).rgb        * 0.2960;
  col     += texture2D(tex, uv - 1.6414 * px).rgb        * 0.2960;
  col     += texture2D(tex, uv + 3.4737 * px).rgb        * 0.1084;
  col     += texture2D(tex, uv - 3.4737 * px).rgb        * 0.1084;
  col     += texture2D(tex, uv + 5.4153 * px).rgb        * 0.0208;
  col     += texture2D(tex, uv - 5.4153 * px).rgb        * 0.0208;
  return col;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  if (u_horizontal == 1) {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    gl_FragColor = vec4(blurPass(u_scene, uv, vec2(1.0, 0.0)), 1.0);
  } 
  else {
    vec2 uv = v_uv;
    vec3 bgRaw  = blurPass(u_scene, uv, vec2(0.0, 1.0));
    vec3 bgInv  = vec3(1.0) - bgRaw;
    float bgOut = smoothstep(0.1, 0.9, luma(bgInv));
    
    vec2 textUV    = vec2(v_uv.x, 1.0 - v_uv.y);
    float textA    = texture2D(u_text, textUV).a;
    float textLuma = 1.0 - smoothstep(0.45, 0.55, bgOut);
    vec3 finalCol  = mix(vec3(bgOut), vec3(textLuma), textA);
    float finalA   = mix(0.92, 1.0, min(textA * 3.0, 1.0));

    gl_FragColor   = vec4(finalCol, finalA);
  }
}
