# Queue Voice Announcement System

This folder contains the audio files used for the queue voice announcement system.

## Folder Structure

```
Voicelines/
├── alerts/
│   └── dingdong.mp3
├── phrases/
│   ├── queue-number.mp3
│   └── proceed-window.mp3
├── letters/
│   ├── A.mp3
│   ├── B.mp3
│   ├── C.mp3
│   ├── D.mp3
│   ├── E.mp3
│   ├── F.mp3
│   ├── G.mp3
│   ├── H.mp3
│   ├── I.mp3
│   ├── J.mp3
│   ├── K.mp3
│   ├── L.mp3
│   ├── M.mp3
│   ├── N.mp3
│   ├── O.mp3
│   ├── P.mp3
│   ├── Q.mp3
│   ├── R.mp3
│   ├── S.mp3
│   ├── T.mp3
│   ├── U.mp3
│   ├── V.mp3
│   ├── W.mp3
│   ├── X.mp3
│   ├── Y.mp3
│   └── Z.mp3
├── numbers/
│   ├── 0.mp3
│   ├── 1.mp3
│   ├── 2.mp3
│   ├── 3.mp3
│   ├── 4.mp3
│   ├── 5.mp3
│   ├── 6.mp3
│   ├── 7.mp3
│   ├── 8.mp3
│   └── 9.mp3
└── windows/
    ├── window1.mp3
    ├── window2.mp3
    ├── window3.mp3
    ├── window4.mp3
    ├── window5.mp3
    └── window6.mp3
```

## Audio File Requirements

### Alerts
- **dingdong.mp3**: Alert sound played before announcement

### Phrases
- **queue-number.mp3**: "Queue number" announcement
- **proceed-window.mp3**: "Please proceed to window" announcement

### Letters (A-Z)
- Each letter should be pronounced clearly
- Files must be named with uppercase letters (A.mp3, B.mp3, etc.)

### Numbers (0-9)
- Each number should be pronounced clearly
- Files must be named with the digit (0.mp3, 1.mp3, etc.)

### Windows
- **window1.mp3**: "Window 1" or "Window One"
- **window2.mp3**: "Window 2" or "Window Two"
- **window3.mp3**: "Window 3" or "Window Three"
- etc.

## Example Announcement Flow

For queue number **LA-001** going to **Window 3**:

1. Play: `alerts/dingdong.mp3`
2. Play: `phrases/queue-number.mp3`
3. Play: `letters/L.mp3`
4. Play: `letters/A.mp3`
5. Play: `numbers/0.mp3`
6. Play: `numbers/0.mp3`
7. Play: `numbers/1.mp3`
8. Play: `phrases/proceed-window.mp3`
9. Play: `windows/window3.mp3`

## Service Type to Window Mapping

- **RPT** (Real Property Tax) → Window 1
- **BUSINESS** / **BT** (Business Tax) → Window 2
- **MISC** (Miscellaneous) → Window 3

## Audio Format Specifications

- **Format**: MP3
- **Sample Rate**: 44.1 kHz or 48 kHz recommended
- **Bit Rate**: 128 kbps or higher
- **Channels**: Mono or Stereo
- **Duration**: Keep announcements concise (1-3 seconds per file)

## Testing

To test the voice announcement system:

1. Ensure all required audio files are in place
2. Log in as branch staff
3. Navigate to Queue Management
4. Click "Call Next" button
5. The system will play the announcement sequence

## Troubleshooting

If announcements are not playing:

1. Check browser console for errors
2. Verify all audio files exist in correct folders
3. Ensure audio files are in MP3 format
4. Check browser audio permissions
5. Verify file paths match the folder structure

## Notes

- Audio files must be stored locally in the `public/Voicelines` folder
- No external TTS APIs are used
- Announcements play sequentially (no overlapping)
- The "Call Next" button is disabled during announcement playback
