---
title: "The File System API is so underrated"
pubDate: 2026-01-15
cover: ./cover.jpg
description: "Discover why the File System API is underrated and how it enables powerful browser-based utility apps without requiring downloads or installations."
---

The [File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) is so underrated, why isn’t anyone building stuff with it? There's a whole bunch of small utility apps, the kind of freeware you'd normally download and install just to use once or twice, that could just live in your browser instead.

Claude and I threw together a couple examples this afternoon: a bulk file renamer and a swipe-to-delete photo curator (the usual Tinder like photo organizer). You can find both on [smoltools](https://smoltools.davide.im/), my collection of quick utilities I build for myself and throw online.

I'm not sure why this isn't more popular. I guess people don't trust the browser with file access? The API seems pretty capable though, [FileSystemObserver](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver) can even tail files in real time. Combine that with WebAssembly and you could build a lot of the desktop utilities people actually use. The missing piece was always file access, and now it's here. More people should be building with this.
