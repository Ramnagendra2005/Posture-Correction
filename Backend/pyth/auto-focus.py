import cv2
import mediapipe as mp

mp_pose = mp.solutions.pose
pose = mp_pose.Pose()
mp_drawing = mp.solutions.drawing_utils

cap = cv2.VideoCapture(0)
# Output frame size
frame_width, frame_height = 640, 480
crop_width, crop_height = 300, 400  # You can adjust this

while cap.isOpened():
    success, frame = cap.read()
    if not success:
        break
        

    h, w, _ = frame.shape
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB) 
    results = pose.process(frame_rgb)

    # Default center (if no person)
    center_x, center_y = w // 2, h // 2

    if results.pose_landmarks:
        landmarks = results.pose_landmarks.landmark
        nose = landmarks[mp_pose.PoseLandmark.NOSE]
        center_x = int(nose.x * w)
        center_y = int(nose.y * h)

    # Calculate cropping box
    x1 = max(center_x - crop_width // 2, 0)
    y1 = max(center_y - crop_height // 2, 0)
    x2 = min(x1 + crop_width, w)
    y2 = min(y1 + crop_height, h)

    cropped = frame[y1:y2, x1:x2]
    resized = cv2.resize(cropped, (frame_width, frame_height))
    # Optional: Draw landmark
    mp_drawing.draw_landmarks(frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

    cv2.imshow("Auto-Framing Camera", resized)

    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()
