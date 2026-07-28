/* =========================================================================
   DEEP CAST — gl.js
   A thin WebGL2 layer: programs, buffers, VAOs, textures, framebuffers.
   Deliberately small — just enough sugar to keep the render code readable.
   ========================================================================= */
(function (DC) {
  'use strict';

  var GLX = {};

  // ------------------------------------------------------------- compilation
  function compile(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      // Print the offending source with line numbers — debugging GLSL blind is misery.
      var lines = src.split('\n').map(function (l, i) {
        return String(i + 1).padStart(4, ' ') + ' | ' + l;
      }).join('\n');
      console.error('[' + label + '] shader compile failed:\n' + log + '\n' + lines);
      throw new Error('Shader compile failed: ' + label + '\n' + log);
    }
    return sh;
  }

  /**
   * Compile + link a program and reflect every active uniform/attribute up front,
   * so callers can do `p.u.uModel` instead of chasing getUniformLocation.
   */
  GLX.program = function (gl, vsSrc, fsSrc, label, attribs) {
    label = label || 'program';
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + '.vert');
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + '.frag');
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    // Fixed attribute slots across every program, so one VAO can feed many.
    if (attribs) {
      for (var name in attribs) gl.bindAttribLocation(p, attribs[name], name);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link failed: ' + label + '\n' + gl.getProgramInfoLog(p));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    var obj = { prog: p, u: {}, a: {}, label: label };
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      var name = info.name.replace(/\[0\]$/, '');
      obj.u[name] = gl.getUniformLocation(p, info.name);
    }
    var na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (var j = 0; j < na; j++) {
      var ai = gl.getActiveAttrib(p, j);
      obj.a[ai.name] = gl.getAttribLocation(p, ai.name);
    }
    return obj;
  };

  // ----------------------------------------------------------------- buffers
  GLX.buffer = function (gl, data, target, usage) {
    target = target || gl.ARRAY_BUFFER;
    var b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage || gl.STATIC_DRAW);
    gl.bindBuffer(target, null);
    return b;
  };

  /**
   * Build a VAO from a compact description.
   *   attrs: [{ buffer, loc, size, type?, stride?, offset?, divisor?, normalized? }]
   */
  GLX.vao = function (gl, attrs, indexBuffer) {
    var v = gl.createVertexArray();
    gl.bindVertexArray(v);
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      if (a.loc < 0) continue; // attribute optimised out of the shader
      gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(
        a.loc, a.size, a.type || gl.FLOAT, !!a.normalized,
        a.stride || 0, a.offset || 0
      );
      if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
    }
    if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return v;
  };

  // ---------------------------------------------------------------- textures
  GLX.texture2D = function (gl, opts) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(
      gl.TEXTURE_2D, 0,
      opts.internalFormat || gl.RGBA8,
      opts.width, opts.height, 0,
      opts.format || gl.RGBA,
      opts.type || gl.UNSIGNED_BYTE,
      opts.data || null
    );
    var wrap = opts.wrap || gl.CLAMP_TO_EDGE;
    var filter = opts.filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    if (opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    if (opts.aniso) {
      var ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) {
        var max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(opts.aniso, max));
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  };

  /**
   * Colour + optional depth render target. `depthTexture` makes the depth
   * buffer sampleable, which the water shader needs for depth-based colour.
   */
  GLX.framebuffer = function (gl, width, height, opts) {
    opts = opts || {};
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    var color = GLX.texture2D(gl, {
      width: width, height: height,
      internalFormat: opts.float ? gl.RGBA16F : gl.RGBA8,
      format: gl.RGBA,
      type: opts.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      filter: gl.LINEAR
    });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);

    var depth = null, depthRb = null;
    if (opts.depthTexture) {
      depth = GLX.texture2D(gl, {
        width: width, height: height,
        internalFormat: gl.DEPTH_COMPONENT24,
        format: gl.DEPTH_COMPONENT,
        type: gl.UNSIGNED_INT,
        filter: gl.NEAREST
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    } else if (opts.depth !== false) {
      depthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }

    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn('Framebuffer incomplete: 0x' + status.toString(16));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return {
      fb: fb, color: color, depth: depth, depthRb: depthRb,
      width: width, height: height,
      bind: function () {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, width, height);
      },
      dispose: function () {
        gl.deleteFramebuffer(fb);
        gl.deleteTexture(color);
        if (depth) gl.deleteTexture(depth);
        if (depthRb) gl.deleteRenderbuffer(depthRb);
      }
    };
  };

  // Bind a texture to a unit and point a sampler uniform at it.
  GLX.bindTex = function (gl, unit, tex, loc) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
  };

  // A single triangle covering the screen — cheaper than a quad, no seam.
  GLX.fullscreenVAO = function (gl, loc) {
    var buf = GLX.buffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]));
    return GLX.vao(gl, [{ buffer: buf, loc: loc, size: 2 }]);
  };

  DC.GLX = GLX;
})(DC);
