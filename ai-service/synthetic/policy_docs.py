"""
policy_docs.py — Sample resort policy documents for RAG ingestion.
These are used for the evaluation harness (30-question test set).
"""

SAMPLE_POLICIES = [
    {
        "content_type": "policy",
        "source_label": "Check-in/Check-out Policy",
        "source_version": "v1",
        "content_text": """Check-In and Check-Out Policy

Standard Check-in: 2:00 PM | Standard Check-out: 11:00 AM

Early Check-in (before 2:00 PM):
- Available subject to room availability
- Fee: Rs. 150 per hour
- Request at reception upon arrival

Late Check-out (after 11:00 AM):
- Up to 2:00 PM: Rs. 150 per hour
- After 2:00 PM: Full night rate charged
- Must be pre-approved by reception

Identification: Valid government-issued photo ID required at check-in.
Foreign nationals: Passport required; Form C filed within 24 hours.""",
    },
    {
        "content_type": "policy",
        "source_label": "Cancellation Policy",
        "source_version": "v1",
        "content_text": """Cancellation and Refund Policy

Free Cancellation: Up to 48 hours before check-in
Within 48 hours: First night’s rate retained
No-show: Full booking amount forfeited

Refund Processing:
- Credit/Debit card: 5–7 business days
- UPI: 2–3 business days
- Cash bookings: Refunded at property only

Group Bookings (5+ rooms): 7-day cancellation notice required.

Modifications: Date changes allowed up to 24 hours before check-in subject to availability.""",
    },
    {
        "content_type": "faq",
        "source_label": "Amenities FAQ",
        "source_version": "v1",
        "content_text": """Frequently Asked Questions — Amenities

Q: Does the resort have a swimming pool?
A: Yes, our outdoor pool is open 7:00 AM to 8:00 PM daily.

Q: Is WiFi available?
A: Complimentary high-speed WiFi is available throughout the property. Password provided at check-in.

Q: Are meals included?
A: Breakfast (7:00–10:30 AM) is included with all room bookings.
Lunch and dinner available at our in-house restaurant.

Q: Is parking available?
A: Yes, free parking for all guests. Valet service available on request.

Q: Do you allow pets?
A: We are a pet-friendly property. Please inform us at booking. Pet fee: Rs. 500/night.

Q: Is there a gym?
A: A fully equipped gym is available 6:00 AM to 9:00 PM for all guests.""",
    },
    {
        "content_type": "faq",
        "source_label": "Booking FAQ",
        "source_version": "v1",
        "content_text": """Frequently Asked Questions — Bookings

Q: What is the minimum age to book a room?
A: The primary guest must be at least 18 years of age.

Q: Can I pay in cash?
A: Yes, cash, card, and UPI are accepted. Advance payment may be required for cash bookings.

Q: Do you offer discounts for longer stays?
A: Yes: 5% off for 3+ nights, 10% off for 7+ nights (direct bookings only).

Q: How do I request a specific room?
A: Mention your preference in the special requests field. We will do our best to accommodate.

Q: What is the maximum occupancy per room?
A: Standard rooms: 2 adults + 1 child. Deluxe rooms: 3 adults. Presidential Suite: 4 adults.""",
    },
    {
        "content_type": "policy",
        "source_label": "Property Rules",
        "source_version": "v1",
        "content_text": """Property Rules and Regulations

Quiet Hours: 10:00 PM to 7:00 AM
Smoking: Permitted in designated outdoor areas only. Rs. 2000 fine for indoor smoking.
Alcohol: Permitted in rooms and bar area. No outside alcohol allowed.
Visitors: Day visitors allowed until 8:00 PM; must register at reception.
Damages: Guests are liable for any damage caused to property.

For emergencies, dial 0 from any room phone or call +91-XXXXX-XXXXX.""",
    },
]

# 30-question evaluation set (ground truth for RAG evaluation)
EVAL_QUESTIONS = [
    ("What time is check-in?", "Check-in", "2:00 PM"),
    ("What time is check-out?", "Check-out", "11:00 AM"),
    ("How much is early check-in?", "Early Check-in", "Rs. 150 per hour"),
    ("Can I check out late?", "Late Check-out", "available with fee"),
    ("What ID do I need?", "Identification", "government-issued photo ID"),
    ("What is the cancellation policy?", "Cancellation", "48 hours"),
    ("If I cancel last minute do I get a refund?", "Cancellation", "first night retained"),
    ("How long does refund take for card?", "Refund", "5-7 business days"),
    ("Is there a swimming pool?", "Pool", "7:00 AM to 8:00 PM"),
    ("Is WiFi free?", "WiFi", "Complimentary"),
    ("Is breakfast included?", "Breakfast", "included with all room bookings"),
    ("What are the restaurant hours?", "Restaurant", "7:00 AM to 10:30 AM"),
    ("Is parking available?", "Parking", "free parking"),
    ("Are pets allowed?", "Pets", "pet-friendly"),
    ("What is the pet fee?", "Pet fee", "Rs. 500/night"),
    ("Is there a gym?", "Gym", "6:00 AM to 9:00 PM"),
    ("What is the minimum age to book?", "Age", "18 years"),
    ("Can I pay cash?", "Payment", "cash, card, and UPI"),
    ("Is there a discount for long stays?", "Discount", "5% off for 3+ nights"),
    ("What is the maximum occupancy?", "Occupancy", "2 adults"),
    ("When are quiet hours?", "Quiet hours", "10:00 PM to 7:00 AM"),
    ("Can I smoke in my room?", "Smoking", "designated outdoor areas only"),
    ("Can I bring outside alcohol?", "Alcohol", "No outside alcohol"),
    ("Can guests visit me?", "Visitors", "until 8:00 PM"),
    ("What happens if I damage something?", "Damage", "liable for damage"),
    ("What is the no-show policy?", "No-show", "Full booking amount forfeited"),
    ("How do I cancel a group booking?", "Group", "7-day cancellation notice"),
    ("Can I change my booking dates?", "Modification", "24 hours before"),
    ("What is the emergency number?", "Emergency", "dial 0"),
    ("Do you have valet parking?", "Valet", "Valet service available"),
]
