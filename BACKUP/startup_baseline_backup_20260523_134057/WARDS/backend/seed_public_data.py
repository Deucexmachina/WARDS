from database.models import (
    SessionLocal, Service, BranchService, FAQ, TaxpayerGuide,
    BranchOperatingHours, Branch
)
from datetime import datetime

def seed_public_data():
    db = SessionLocal()
    
    try:
        # Create Services
        if db.query(Service).count() == 0:
            services = [
                Service(
                    name="Real Property Tax",
                    description="Payment of annual real property taxes",
                    category="Tax Payment",
                    average_processing_time=15,
                    requires_appointment=False,
                    is_active=True
                ),
                Service(
                    name="Business Tax",
                    description="Payment of business permits and taxes",
                    category="Tax Payment",
                    average_processing_time=20,
                    requires_appointment=False,
                    is_active=True
                ),
                Service(
                    name="Miscellaneous Tax",
                    description="Payment of miscellaneous taxes and fees",
                    category="Tax Payment",
                    average_processing_time=15,
                    requires_appointment=False,
                    is_active=True
                )
            ]
            db.add_all(services)
            db.commit()
            print("Created services")
            
            # Link services to branches
            branches = db.query(Branch).all()
            services = db.query(Service).all()
            
            for branch in branches:
                for service in services:
                    branch_service = BranchService(
                        branch_id=branch.id,
                        service_id=service.id,
                        is_available=True
                    )
                    db.add(branch_service)
            db.commit()
            print("Linked services to branches")
        
        # Create Operating Hours
        if db.query(BranchOperatingHours).count() == 0:
            branches = db.query(Branch).all()
            days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
            
            for branch in branches:
                for day in days:
                    hours = BranchOperatingHours(
                        branch_id=branch.id,
                        day_of_week=day,
                        opening_time="08:00",
                        closing_time="17:00" if day != "Saturday" else "12:00",
                        is_open=True if day != "Saturday" or branch.name == "Galas Branch" else False
                    )
                    db.add(hours)
            db.commit()
            print("Created operating hours")
        
        # Create FAQs (English)
        if db.query(FAQ).count() == 0:
            faqs_en = [
                FAQ(
                    question="What are the accepted payment methods?",
                    answer="We accept cash, check, credit/debit cards, and online payment through our payment gateway.",
                    category="Payment",
                    language="en",
                    order=1,
                    is_active=True
                ),
                FAQ(
                    question="What documents do I need for real property tax payment?",
                    answer="You need to bring your Tax Declaration and previous year's Official Receipt.",
                    category="Requirements",
                    language="en",
                    order=2,
                    is_active=True
                ),
                FAQ(
                    question="Can I pay my taxes online?",
                    answer="Yes, you can pay through our online payment portal. Select your service type and follow the payment instructions.",
                    category="Payment",
                    language="en",
                    order=3,
                    is_active=True
                ),
                FAQ(
                    question="How do I get a queue number?",
                    answer="You can register for a queue number online through our public portal or get one at the branch office.",
                    category="Queue",
                    language="en",
                    order=4,
                    is_active=True
                ),
                FAQ(
                    question="What are the office hours?",
                    answer="Most branches are open Monday to Friday, 8:00 AM to 5:00 PM. Some branches have Saturday hours. Check the specific branch page for details.",
                    category="General",
                    language="en",
                    order=5,
                    is_active=True
                )
            ]
            
            # FAQs (Tagalog)
            faqs_tl = [
                FAQ(
                    question="Ano ang mga tanggap na paraan ng pagbabayad?",
                    answer="Tumatanggap kami ng cash, check, credit/debit card, at online payment sa pamamagitan ng aming payment gateway.",
                    category="Payment",
                    language="tl",
                    order=1,
                    is_active=True
                ),
                FAQ(
                    question="Anong mga dokumento ang kailangan para sa real property tax payment?",
                    answer="Kailangan ninyong dalhin ang inyong Tax Declaration at Official Receipt ng nakaraang taon.",
                    category="Requirements",
                    language="tl",
                    order=2,
                    is_active=True
                ),
                FAQ(
                    question="Maaari ba akong magbayad ng buwis online?",
                    answer="Oo, maaari kayong magbayad sa pamamagitan ng aming online payment portal. Piliin ang uri ng serbisyo at sundin ang mga tagubilin sa pagbabayad.",
                    category="Payment",
                    language="tl",
                    order=3,
                    is_active=True
                ),
                FAQ(
                    question="Paano ako makakakuha ng queue number?",
                    answer="Maaari kayong magrehistro para sa queue number online sa pamamagitan ng aming public portal o kumuha ng isa sa branch office.",
                    category="Queue",
                    language="tl",
                    order=4,
                    is_active=True
                ),
                FAQ(
                    question="Ano ang oras ng tanggapan?",
                    answer="Karamihan ng mga sangay ay bukas Lunes hanggang Biyernes, 8:00 AM hanggang 5:00 PM. May mga sangay na may oras sa Sabado. Tingnan ang specific na pahina ng sangay para sa mga detalye.",
                    category="General",
                    language="tl",
                    order=5,
                    is_active=True
                )
            ]
            
            db.add_all(faqs_en + faqs_tl)
            db.commit()
            print("Created FAQs")
        
        # Create Taxpayer Guides (English)
        if db.query(TaxpayerGuide).count() == 0:
            guides_en = [
                TaxpayerGuide(
                    title="How to Pay Real Property Tax",
                    content="""
1. Prepare your Tax Declaration and previous Official Receipt
2. Visit any branch office or use our online payment portal
3. Present your documents to the counter staff
4. Pay the assessed amount
5. Receive your Official Receipt
6. Keep the receipt for your records

For online payment:
1. Go to the Online Payment section
2. Select 'Real Property Tax Payment'
3. Enter your property details
4. Complete the payment through the gateway
5. Download your receipt
                    """,
                    category="Tax Payment",
                    language="en",
                    order=1,
                    is_active=True
                ),
                TaxpayerGuide(
                    title="Business Permit Requirements",
                    content="""
Required Documents:
1. DTI/SEC/CDA Registration
2. Barangay Clearance
3. Locational Clearance
4. Fire Safety Inspection Certificate
5. Sanitary Permit
6. Contract of Lease (if renting)
7. Valid ID of Owner/Representative

Process:
1. Submit complete requirements
2. Pay business taxes and fees
3. Wait for assessment and inspection
4. Claim your Business Permit
                    """,
                    category="Business",
                    language="en",
                    order=2,
                    is_active=True
                ),
                TaxpayerGuide(
                    title="How to Request Receipt Copies",
                    content="""
1. Fill out the Receipt Request Form online
2. Provide transaction details (date, reference number)
3. Pay the processing fee (₱50.00)
4. Wait for email confirmation
5. Receive digital copy via email or pick up at the branch

Processing Time: 3-5 business days
                    """,
                    category="Document Request",
                    language="en",
                    order=3,
                    is_active=True
                )
            ]
            
            # Taxpayer Guides (Tagalog)
            guides_tl = [
                TaxpayerGuide(
                    title="Paano Magbayad ng Real Property Tax",
                    content="""
1. Ihanda ang inyong Tax Declaration at nakaraang Official Receipt
2. Bumisita sa anumang branch office o gamitin ang aming online payment portal
3. Ipakita ang inyong mga dokumento sa counter staff
4. Magbayad ng tinasang halaga
5. Tanggapin ang inyong Official Receipt
6. Itago ang resibo para sa inyong mga talaan

Para sa online payment:
1. Pumunta sa Online Payment section
2. Piliin ang 'Real Property Tax Payment'
3. Ilagay ang inyong property details
4. Kumpletuhin ang pagbabayad sa pamamagitan ng gateway
5. I-download ang inyong resibo
                    """,
                    category="Tax Payment",
                    language="tl",
                    order=1,
                    is_active=True
                ),
                TaxpayerGuide(
                    title="Mga Kinakailangan sa Business Permit",
                    content="""
Mga Kinakailangang Dokumento:
1. DTI/SEC/CDA Registration
2. Barangay Clearance
3. Locational Clearance
4. Fire Safety Inspection Certificate
5. Sanitary Permit
6. Contract of Lease (kung umuupa)
7. Valid ID ng May-ari/Kinatawan

Proseso:
1. Isumite ang kumpletong requirements
2. Magbayad ng business taxes at fees
3. Maghintay para sa assessment at inspection
4. Kunin ang inyong Business Permit
                    """,
                    category="Business",
                    language="tl",
                    order=2,
                    is_active=True
                )
            ]
            
            db.add_all(guides_en + guides_tl)
            db.commit()
            print("Created Taxpayer Guides")
        
        print("Public data seeding completed successfully!")
        
    except Exception as e:
        print(f"Error seeding public data: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_public_data()
