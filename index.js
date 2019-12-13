const createNsfPlayer = (audioContext, message) => {
  // Messages are disabled. Feel free to handle them however you like.
  if (typeof audioContext == 'function') {
    message = audioContext;
    audioContext = null;
  }
  if (typeof message != 'function') message = () => null;

  let songData = null;
  let fileName = null;

  let ref;
  let emu;
  let node;


  const load = (_fileName) => {
    fileName = _fileName;

    if (node) {
      node.disconnect();
      node = null;
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', fileName, true);
      xhr.responseType = 'arraybuffer';
      xhr.onerror = (e) => {
        message(e);
      };
      xhr.onload = function(e) {
        if (this.status === 404){
          message('not found');
          reject('not found');
          return;
        }

        initBuffer(this.response);

        resolve();
        };
      xhr.send();
    });
  }

  // initializes songData, ref, emu, context for playback and track info retrieval
  const initBuffer = (data) => {
    songData = new Uint8Array(data);

    ref = Module.allocate(1, 'i32', Module.ALLOC_STATIC);

    if (!window.AudioContext) {
      if (window.webkitAudioContext) {
        window.AudioContext = window.webkitAudioContext;
      } else if (window.mozAudioContext) {
        window.AudioContext = window.mozAudioContext;
      } else {
        message('Web Audio API is not supported.');
      }
    }

    try {
      ctx = audioContext || new AudioContext();
    } catch(err) {
      console.error(`Unable to create AudioContext. Error: ${err}`);
      return;
    }

    const samplerate = ctx.sampleRate;

    if (Module.ccall('gme_open_data', 'number', ['array', 'number', 'number', 'number'], [songData, songData.length, ref, samplerate]) != 0) {
      console.error('gme_open_data failed.');
      return;
    }

    emu = Module.getValue(ref, 'i32');
  }

  const play = (trackNo) => {
    if (songData == null) {
      throw new Error('no file has been loaded');
    }

    if (node) {
      node.disconnect();
      node = null;
    }

    playTrack(trackNo);
    // updateSongInfo(fileName, trackNo);
  };

  const stop = () => {
    if (!node) {
      return;
    }

    node.disconnect();
    // if (Module.ccall('gme_delete', 'number', ['number'], [emu]) != 0) {
    //   console.error('Failed to stop track.');
    // }
  };

  const getTrackCount = () => {
    if (songData == null) {
      throw new Error('no file has been loaded');
    }

  // const updateSongInfo = (filename, subtune) => {
    return Module.ccall('gme_track_count', 'number', ['number'], [emu]);
  };

  const getTrackInfo = (track) => {
    if (songData == null) {
      throw new Error('no file has been loaded');
    }

  // const updateSongInfo = (filename, subtune) => {
    // const subtune_count = Module.ccall('gme_track_count', 'number', ['number'], [emu]);

    if (Module.ccall('gme_track_info', 'number', ['number', 'number', 'number'], [emu, ref, track]) != 0) {
      console.error('Could not load metadata.');
    }

    return parseMetadata(Module.getValue(ref, '*'));
  };

  const unload = () => {
    Module.ccall('gme_delete', 'number', ['number'], [emu]);
  }

  const parseMetadata = ref => {
    let offset = 0;

    const read_int32 = () => {
       const value = Module.getValue(ref + offset, 'i32');
       offset += 4;
       return value;
     };

     const read_string = () => {
       const value = Module.Pointer_stringify(Module.getValue(ref + offset, 'i8*'));
       offset += 4;
       return value;;
     }

     const res = {};

     res.length = read_int32();
     res.intro_length = read_int32();
     res.loop_length = read_int32();
     res.play_length = read_int32();

     offset += 4*12; // skip unused bytes

     res.system = read_string();
     res.game = read_string();
     res.song = read_string();
     res.author = read_string();
     res.copyright = read_string();
     res.comment = read_string();

     return res;
  };

  const playTrack = (subtune) => {
    Module.ccall('gme_ignore_silence', 'number', ['number'], [emu, 1]);

    if (Module.ccall('gme_start_track', 'number', ['number', 'number'], [emu, subtune]) != 0) {
      console.error('Failed to load track.');
      return;
    }

    const bufferSize = 1024 * 16;
    const inputs = 2;
    const outputs = 2;

    if (!node && ctx.createJavaScriptNode) {
      node = ctx.createJavaScriptNode(bufferSize, inputs, outputs);
    }
    if (!node && ctx.createScriptProcessor) {
      node = ctx.createScriptProcessor(bufferSize, inputs, outputs);
    }

    const buffer = Module.allocate(bufferSize * 2, 'i32', Module.ALLOC_STATIC);

    const INT16_MAX = Math.pow(2, 32) - 1;

    node.onaudioprocess = (e) => {
      if (Module.ccall('gme_track_ended', 'number', ['number'], [emu]) == 1) {
        node.disconnect();
        message('End of stream.');
        return;
      }

      const channels = [e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1)];

      const err = Module.ccall('gme_play', 'number', ['number', 'number', 'number'], [emu, bufferSize * 2, buffer]);
      for (var i = 0; i < bufferSize; i++) {
        for (var n = 0; n < e.outputBuffer.numberOfChannels; n++) {
          channels[n][i] = Module.getValue(buffer + i * e.outputBuffer.numberOfChannels * 2 + n * 4, 'i32') / INT16_MAX;
        }
      }
    }

    node.connect(ctx.destination);

  };

  return { load, play, stop, getTrackCount, getTrackInfo, unload };
};
