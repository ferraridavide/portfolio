---
title: "Using Python to automate text overlays in Premiere Pro"
pubDate: 2023-01-03
description: "Automate text overlays and subtitles in Adobe Premiere Pro using Python, EDL exports, and SRT files. A step-by-step guide to programmatically add captions to your video projects."
---

Recently, I embarked on a weekend project to create a video compilation of all the intros from the tech show TechLinked (which you can [check out here](https://www.youtube.com/watch?v=6gZ1TMZpnXw)). I figured it wouldn't be too hard and I wouldn't need to write any code, but as it turned out, I ended up having to resort to some Python to get the job done.

I had my Premiere Pro sequence all set up with all the intros chopped up and ready to go, but when I wanted to add text displaying the name and date of the current clip, I couldn't figure out how to do it in Premiere Pro. I was looking for something similar to After Effects' expressions, but unfortunately, this feature is not present in Premiere Pro. I tried everything I could think of, but nada. 

That's when I had to turn to Python to get the job done. In this blog post, I'll show you how I used Python and Premiere Pro's EDL export feature to make it all happen. 
This method allows you to quickly and easily add subtitles or captions to your video, without having to manually add them frame by frame.

Here's what we'll do, we're going to use Premiere Pro's EDL export feature to get a text file with all the necessary information about the cuts in our sequence. Then, we'll use Python to convert that EDL file into an SRT file, a format that Premiere Pro can import as subtitles. If you're unfamiliar with EDL, don't worry – I didn't know what it was before this either. It looks something like this:
```text
TITLE: [name of the exported sequence]
FCM: NON-DROP FRAME

001  AX       AA/V  C        00:00:00:00 00:00:08:04 00:00:00:00 00:00:08:04 
* FROM CLIP NAME: 2022-01-01 [b_s9oeQsNfw].mp4
* AUDIO LEVEL AT 00:00:00:00 IS -0.00 DB  (REEL AX A1)
* AUDIO LEVEL AT 00:00:00:00 IS -0.00 DB  (REEL AX A2)

002  AX       AA/V  C        00:00:00:00 00:00:11:20 00:00:08:04 00:00:19:24 
* FROM CLIP NAME: 2022-01-04 [O8PdzoHyM98].mp4
* AUDIO LEVEL AT 00:00:00:00 IS -0.00 DB  (REEL AX A1)
* AUDIO LEVEL AT 00:00:00:00 IS -0.00 DB  (REEL AX A2)
```

As you can see, it contains information about the edits in the sequence, including the clip name, the start and end timecodes of the clip, and the start and end timecodes of the edit on the timeline. 

Alright, let's get to the code!

* In Premiere Pro, select the sequence you want to export then go to File > Export > EDL. A dialog will pop up, just press OK and save the EDL file.
* Install the `timecode`, `edl` and `srt` libraries using `pip install timecode edl srt` and import them in your Python script
* Let's use the `edl` library to parse the EDL file.

    ```python
    parser=edl.Parser('29.97')  # Set your sequence's frame rate here
    with open('file.edl') as edl_file:
        edl=parser.parse(edl_file)
        events = edl.events
    ```
    This will create a list of `Event` objects, each representing a single edit in the EDL file.
* Iterate through the list of events and create a list of `srt.Subtitle` objects. By default, the `clip_name` is the file name of the clip. If you want to display something different in the SRT file, you can create a separate Python function that takes the file name as input and returns the desired text.
    ```python
    tc = timecode.Timecode('29.97')
    def to_timedelta(time_code):
        t = tc.parse_timecode(str(time_code))
        td = timedelta(hours=t[0], minutes=t[1], seconds=t[2], milliseconds=(t[3]/29.97)*1000)
        return timedelta(seconds=td.total_seconds()*1.001)

    def get_text(filename):
        # Returns the desired text based on the filename
        return filename

    subtitles = []
    for index, event in enumerate(events, start=1):
        start_time = to_timedelta(event.rec_start_tc)
        end_time = to_timedelta(event.rec_end_tc)
        clip_name = get_text(event.clip_name)
        subtitles.append(srt.Subtitle(index, start_time, end_time, clip_name))
    ```
    You may notice that in the `to_timedelta` function, I'm scaling the length of every clip by 1.001, this is a workaround I found as without this, the subtitles wouldn't align properly in the timeline.
* Use the `srt` library to create the SRT file.
    ```python
    with open('subtitles.srt', 'w') as srt_file:
        srt.dump(subtitles, srt_file)
    ```

* And voila! You can now import the .srt file into Premiere Pro and drag in right into your timeline!
It should look something like this:
    ```text
    1
    00:00:00,000 --> 00:00:08,141
    SSD go brrr
    01 January 2022

    2
    00:00:08,141 --> 00:00:19,820
    We thought it wasn't possible...
    04 January 2022
    ```


That's it! In my case, every clip filename contained the TechLinked episode's video ID, so i had my `get_text` function parse the ID using regular expressions, then call YouTube's API to obtain the video title and upload date

While this technique is particularly useful for adding automatic text overlays or subtitles, the possibilities don't stop there. EDL files contain a wealth of information about the edits in your sequence, so you can use this information in many other ways. For example, you could use an EDL file to automatically create YouTube chapters based on the cuts in your sequence.
