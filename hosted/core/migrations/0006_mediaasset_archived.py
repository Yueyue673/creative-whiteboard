from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0005_accountsession")]

    operations = [
        migrations.AddField(
            model_name="mediaasset", name="archived",
            field=models.BooleanField(default=False),
        ),
    ]
